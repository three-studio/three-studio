import { execFile, spawn } from 'node:child_process';
import { mkdir, open, readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { shellEnvironment } from '../launch/electron';
import { decodeRunResult } from './compare';
import type { ScenarioResult } from './results';

/*
 * The two trees of an A/B. The other is a worktree of the commit compared
 * with, inside the run's folder, its `node_modules` this tree's, built with
 * its own `npm run build`. Its projects, its page functions and its formats
 * are its own: an older tree may read another format, or other editor
 * internals.
 *
 * Both trees are measured alike: each launch by the tree's own harness, in a
 * process of its own. A launch run in this run's process finds it warm — its
 * JIT, its heap, the scenarios before — where the other tree's starts cold:
 * on the same commit, the scan of 3 000 assets came out a fifth apart, and
 * every Node-side timing leaned the same way.
 */

const exec = promisify(execFile);

/** Where a tree's harness runs, and where it keeps its projects and writes its result. */
export interface TreeFolders {
  readonly root: string;
  readonly scratch: string;
  readonly result: string;
}

/**
 * One launch of a scenario by a tree's own harness. The environment is the
 * shell's: this run's own variables would make the child an A/B of its own,
 * or send its report where this run's goes.
 */
export function harnessCommand(
  tree: TreeFolders,
  scenario: string,
): { command: string; args: string[]; cwd: string; env: Record<string, string> } {
  return {
    command: 'npx',
    args: ['vitest', 'run', '--config', 'tools/perf/vitest.config.ts', '-t', `${scenario} —`],
    cwd: tree.root,
    env: { ...shellEnvironment(/^PERF_/), PERF_LAUNCHES: '1', PERF_RESULT: tree.result, PERF_SCRATCH: tree.scratch },
  };
}

/** Runs a command to its end, its output in `log`; refuses an exit other than 0, naming the log. */
async function runLogged(command: string, args: readonly string[], cwd: string, log: string, env: Record<string, string>): Promise<void> {
  const file = await open(log, 'w');
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      spawn(command, args, { cwd, env, stdio: ['ignore', file.fd, file.fd] })
        .once('exit', resolve)
        .once('error', reject);
    });
    if (code !== 0) throw new Error(`${command} ${args.join(' ')} exited ${String(code)}; see ${log}`);
  } finally {
    await file.close();
  }
}

type Launch = (scenario: string, pair: number) => Promise<ScenarioResult>;

/**
 * A tree's launches. Its run folder is kept between them: the tree prepares
 * each scenario's projects once, then goes straight to its launch at every pair.
 */
function launchesOf(root: string, scratch: string, logs: string, side: string): Launch {
  return async (scenario, pair) => {
    const name = `ab-${side}-${scenario}-${pair}`;
    const command = harnessCommand({ root, scratch, result: join(logs, `${name}.json`) }, scenario);
    await runLogged(command.command, command.args, command.cwd, join(logs, `${name}.log`), command.env);
    const decoded = decodeRunResult(JSON.parse(await readFile(join(logs, `${name}.json`), 'utf8')));
    const scenarioResult = decoded?.scenarios[scenario];
    if (scenarioResult === undefined) throw new Error(`${side}: ${scenario} wrote no result; see ${join(logs, `${name}.log`)}`);
    return scenarioResult;
  };
}

export interface Ab {
  /** The other tree's commit, short. */
  readonly against: string;
  readonly ours: Launch;
  readonly theirs: Launch;
  remove(): Promise<void>;
}

export async function abAgainst(repo: string, runDir: string, commit: string): Promise<Ab> {
  const short = (await exec('git', ['-C', repo, 'rev-parse', '--short', commit])).stdout.trim();
  const path = join(runDir, 'ab-tree');
  const scratch = join(runDir, 'ab-theirs');
  const logs = join(runDir, 'logs');
  await mkdir(logs, { recursive: true });
  await exec('git', ['-C', repo, 'worktree', 'add', '--detach', path, commit]);
  await symlink(join(repo, 'node_modules'), join(path, 'node_modules'));
  await runLogged('npm', ['run', 'build'], path, join(logs, 'ab-tree-build.log'), shellEnvironment(/^PERF_/));
  return {
    against: short,
    ours: launchesOf(repo, join(runDir, 'ab-ours'), logs, 'ours'),
    theirs: launchesOf(path, scratch, logs, 'theirs'),
    remove: async () => {
      await exec('git', ['-C', repo, 'worktree', 'remove', '--force', path]);
      await rm(scratch, { recursive: true, force: true });
    },
  };
}

/** Launches of one scenario, gathered into one result: their values side by side, in order. */
export function mergeLaunches(results: readonly ScenarioResult[]): ScenarioResult {
  const [first] = results;
  if (first === undefined) throw new Error('no launch to merge');
  const metrics: Record<string, ScenarioResult['metrics'][string]> = {};
  for (const [name, metric] of Object.entries(first.metrics)) {
    metrics[name] = { ...metric, launches: results.flatMap((result) => result.metrics[name]?.launches ?? []) };
  }
  return { metrics, window: first.window, notes: first.notes };
}
