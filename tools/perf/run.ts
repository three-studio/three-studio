import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { type OtherTree, mergeLaunches, otherTree } from './report/ab';
import {
  RESULT_VERSION,
  type RunResult,
  compareAb,
  compareRuns,
  decodeRunResult,
  newestRun,
} from './report/compare';
import { type RunConditions, conditionsNow, freeBytes } from './report/conditions';
import { type ScenarioResult, summaryOf } from './report/results';
import { abMarkdown, reportName, runMarkdown } from './report/write';
import { assetsScenario } from './scenarios/assets';
import { bigAssetsScenario } from './scenarios/bigAssets';
import type { Scenario, ScenarioContext } from './scenarios/context';
import { playAndScenesScenario } from './scenarios/playAndScenes';
import { playerScenario } from './scenarios/player';
import { renderScenario } from './scenarios/render';
import { sceneScaleScenario } from './scenarios/sceneScale';

/*
 * A performance run: the scenarios, one after another, against the production
 * build `npm run perf` has just made. Started by `tools/perf/vitest.config.ts`,
 * one `it` per scenario; see the README.
 *
 * Everything the run makes — projects, application data, logs, exports — goes
 * in one folder: `$TMPDIR/three-studio-perf/<run>/`, or `PERF_SCRATCH`. It is
 * removed at the end of a run that succeeded and kept, and named, when one
 * failed; a folder `PERF_SCRATCH` named is always kept, with each scenario's
 * prepared projects, for this tree's next run.
 *
 * `PERF_AGAINST=<commit>` makes the run an A/B: each scenario alternates one
 * launch of the other tree's harness with one of this tree's, and the run's
 * own report is made of this tree's side of the pairs.
 */

const exec = promisify(execFile);
const repo = fileURLToPath(new URL('../..', import.meta.url));

/** The space the biggest scenario needs at its peak, with room to spare: below it, nothing is written. */
const MINIMUM_FREE_BYTES = 3 * 1024 ** 3;

/** The scenarios, in the order a run takes them. `-t S3` runs one. */
const SCENARIOS: readonly { readonly id: string; readonly title: string; readonly run: Scenario }[] = [
  { id: 'S1', title: 'big assets', run: bigAssetsScenario },
  { id: 'S2', title: 'scene scale', run: sceneScaleScenario },
  { id: 'S3', title: 'render', run: renderScenario },
  { id: 'S5', title: 'assets', run: assetsScenario },
  { id: 'S6', title: 'Play and scenes', run: playAndScenesScenario },
  { id: 'S7', title: 'player', run: playerScenario },
];

/** `PERF_LAUNCHES`: measured launches per scenario, three unless it says otherwise. */
function launchesWanted(): number {
  const wanted = Number(process.env['PERF_LAUNCHES'] ?? '3');
  if (!Number.isInteger(wanted) || wanted < 1) throw new Error(`PERF_LAUNCHES must be a whole number above 0`);
  return wanted;
}

/** Every process whose command line names the run's folder: the editors and Chromes it launched. */
async function processesIn(runDir: string): Promise<string[]> {
  try {
    return (await exec('pgrep', ['-fl', runDir])).stdout.trim().split('\n').filter((line) => line !== '');
  } catch {
    return [];
  }
}

/** Every run kept in a folder, as its JSON says. */
async function runsIn(folder: string): Promise<RunResult[]> {
  const runs: RunResult[] = [];
  for (const name of await readdir(folder).catch(() => [])) {
    if (!name.endsWith('.json')) continue;
    const decoded = decodeRunResult(JSON.parse(await readFile(join(folder, name), 'utf8')));
    if (decoded !== null) runs.push(decoded);
  }
  return runs;
}

describe('a performance run', () => {
  const named = process.env['PERF_SCRATCH'];
  const against = process.env['PERF_AGAINST'];
  const out = process.env['PERF_OUT'];
  const label = process.env['PERF_LABEL'] ?? 'run';
  const runDir = named ?? join(tmpdir(), 'three-studio-perf', new Date().toISOString().replace(/[:.]/g, '-'));
  const startedAt = new Date().toISOString();
  let caffeinate: ChildProcess | null = null;
  let failed = false;
  let conditions: RunConditions | null = null;
  let tree: OtherTree | null = null;
  const results = new Map<string, ScenarioResult>();
  const theirs = new Map<string, ScenarioResult>();
  const context: ScenarioContext = {
    repo,
    runDir,
    launches: launchesWanted(),
    shots: process.env['PERF_SHOTS'] ?? null,
    keep: named !== undefined,
    say: (line) => void process.stdout.write(`[perf] ${line}\n`),
  };

  beforeAll(async () => {
    const free = await freeBytes(runDir);
    if (free < MINIMUM_FREE_BYTES) {
      throw new Error(`${(free / 1024 ** 3).toFixed(1)} GB free where the run would write; it needs 3 GB.`);
    }
    await mkdir(runDir, { recursive: true });
    if (context.shots !== null) await mkdir(context.shots, { recursive: true });
    // The display kept awake for as long as this worker lives: a sleeping
    // display stops the frames being measured.
    caffeinate = spawn('caffeinate', ['-dimsu', '-w', String(process.pid)], { stdio: 'ignore' });
    conditions = await conditionsNow(repo);
    await writeFile(join(runDir, 'conditions.json'), `${JSON.stringify(conditions, null, 2)}\n`);
    process.stdout.write(`[perf] ${JSON.stringify(conditions)}\n`);
    if (against !== undefined) {
      context.say(`A/B against ${against}: preparing the other tree`);
      tree = await otherTree(repo, runDir, against);
    }
  }, 600_000);

  beforeEach(({ onTestFailed }) => {
    onTestFailed(() => {
      failed = true;
    });
  });

  afterAll(async () => {
    caffeinate?.kill();
    await tree?.remove().catch(() => undefined);
    if (!failed && conditions !== null && results.size > 0) await report(conditions);
    // Nothing may outlive the run. A launch ends its own process group; what
    // is found here is a launch that did not, and it is ended and named.
    const left = await processesIn(runDir);
    if (left.length > 0) await exec('pkill', ['-f', runDir]).catch(() => undefined);
    if (failed || named !== undefined || out === undefined || left.length > 0) {
      process.stdout.write(`[perf] the run's folder is kept: ${runDir}\n`);
    } else {
      await rm(runDir, { recursive: true, force: true });
    }
    if (left.length > 0) throw new Error(`processes outlived the run:\n${left.join('\n')}`);
  }, 600_000);

  /**
   * The run's result, its report beside the previous run's, and an A/B's own:
   * into `PERF_OUT` when it is named, otherwise into the run's folder and onto
   * the console. `PERF_RESULT` gets the result alone, for the tree on the other
   * side of an A/B.
   */
  async function report(measured: RunConditions): Promise<void> {
    const finishedAt = new Date().toISOString();
    const scenarios = Object.fromEntries(results);
    const abRows = tree === null ? [] : compareAb(scenarios, Object.fromEntries(theirs));
    const noise: Record<string, number> = {};
    for (const row of abRows) if (row.noise !== null && row.kind !== 'reported') noise[`${row.scenario} ${row.metric}`] = row.noise;
    const result: RunResult = { version: RESULT_VERSION, kind: 'run', label, startedAt, finishedAt, conditions: measured, scenarios, noise };
    const resultFile = process.env['PERF_RESULT'];
    if (resultFile !== undefined) await writeFile(resultFile, `${JSON.stringify(result)}\n`);

    const folder = out ?? runDir;
    await mkdir(folder, { recursive: true });
    const previous = out === undefined ? null : newestRun(await runsIn(out));
    const known = new Map(Object.entries(Object.keys(noise).length > 0 ? noise : (previous?.noise ?? {})));
    const rows = compareRuns(result, previous, known);
    const name = reportName(finishedAt, measured.commit, label);
    const markdown = runMarkdown(result, rows, previous);
    await writeFile(join(folder, `${name}.md`), markdown);
    await writeFile(join(folder, `${name}.json`), `${JSON.stringify(result, null, 2)}\n`);
    if (tree !== null) {
      const abName = reportName(finishedAt, measured.commit, `ab-${tree.commit}`);
      const abResult = { ...result, kind: 'ab', against: { commit: tree.commit, scenarios: Object.fromEntries(theirs) } };
      await writeFile(join(folder, `${abName}.md`), abMarkdown(result, tree.commit, abRows));
      await writeFile(join(folder, `${abName}.json`), `${JSON.stringify(abResult, null, 2)}\n`);
      const confirmed = abRows.filter((row) => row.verdict === 'confirmed' || row.verdict === 'changed');
      context.say(`A/B: ${confirmed.length === 0 ? 'nothing confirmed' : confirmed.map((row) => `${row.scenario} ${row.metric} ${row.verdict}`).join(', ')}`);
    }
    if (out === undefined) process.stdout.write(markdown);
    context.say(`report: ${join(folder, `${name}.md`)}`);

    const suspected = rows.filter((row) => row.verdict === 'suspected' || row.verdict === 'changed');
    if (suspected.length > 0 && previous !== null && tree === null) {
      const ids = [...new Set(suspected.map((row) => row.scenario))];
      context.say(`suspected or changed: ${suspected.map((row) => `${row.scenario} ${row.metric} ${row.verdict}`).join(', ')}`);
      context.say(`confirm with: PERF_AGAINST=${previous.conditions.commit} npm run perf -- -t "${ids.map((id) => `${id} —`).join('|')}"`);
    }
  }

  for (const scenario of SCENARIOS) {
    it(`${scenario.id} — ${scenario.title}`, async () => {
      if (tree === null) {
        const result = await scenario.run(context);
        results.set(scenario.id, result);
        process.stdout.write(summaryOf(scenario.id, result));
        return;
      }
      // An A/B: one launch of the other tree, then one of this tree, as many
      // times as a run has launches. Each side keeps its prepared projects in
      // a folder of its own, so only the first pair pays for them.
      const ours: ScenarioResult[] = [];
      const others: ScenarioResult[] = [];
      for (let pair = 1; pair <= context.launches; pair += 1) {
        others.push(await tree.launch(scenario.id, pair));
        ours.push(await scenario.run({ ...context, launches: 1, keep: true, runDir: join(runDir, 'ab-ours') }));
      }
      const mine = mergeLaunches(ours);
      results.set(scenario.id, mine);
      theirs.set(scenario.id, mergeLaunches(others));
      process.stdout.write(summaryOf(scenario.id, mine));
    });
  }
});
