import { execFile, spawn } from 'node:child_process';
import { mkdir, open, readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { decodeRunResult } from './compare';
import type { ScenarioResult } from './results';

/*
 * The other tree of an A/B: a worktree of the commit compared with, inside
 * the run's folder, its `node_modules` this tree's, built with its own `npm
 * run build`, and measured by its own harness, one launch at a time. Its
 * projects, its page functions and its formats are its own: an older tree may
 * read another format, or other editor internals.
 */

const exec = promisify(execFile);

/**
 * What a child run inherits: this one's environment without the harness's own
 * variables, which would turn it into an A/B of its own, or send its report
 * where this one's goes.
 */
function childEnvironment(extra: Record<string, string>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith('PERF_') && !key.startsWith('VITEST')) kept[key] = value;
  }
  return { ...kept, ...extra };
}

/** Runs a command to its end, its output in `log`; refuses an exit other than 0, naming the log. */
async function runLogged(command: string, args: readonly string[], cwd: string, log: string, env: Record<string, string>): Promise<void> {
  const file = await open(log, 'w');
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      spawn(command, args, { cwd, env: childEnvironment(env), stdio: ['ignore', file.fd, file.fd] })
        .once('exit', resolve)
        .once('error', reject);
    });
    if (code !== 0) throw new Error(`${command} ${args.join(' ')} exited ${String(code)}; see ${log}`);
  } finally {
    await file.close();
  }
}

export interface OtherTree {
  /** The commit, short. */
  readonly commit: string;
  /** One launch of a scenario in that tree, with that tree's harness. */
  launch(scenario: string, pair: number): Promise<ScenarioResult>;
  remove(): Promise<void>;
}

export async function otherTree(repo: string, runDir: string, commit: string): Promise<OtherTree> {
  const short = (await exec('git', ['-C', repo, 'rev-parse', '--short', commit])).stdout.trim();
  const path = join(runDir, 'ab-tree');
  const scratch = join(runDir, 'ab-theirs');
  const logs = join(runDir, 'logs');
  await mkdir(logs, { recursive: true });
  await exec('git', ['-C', repo, 'worktree', 'add', '--detach', path, commit]);
  await symlink(join(repo, 'node_modules'), join(path, 'node_modules'));
  await runLogged('npm', ['run', 'build'], path, join(logs, 'ab-tree-build.log'), {});
  return {
    commit: short,
    launch: async (scenario, pair) => {
      const result = join(logs, `ab-${scenario}-${pair}.json`);
      // Its own run folder, kept: the tree prepares each scenario's projects
      // once, then goes straight to its launch at every pair.
      await runLogged(
        'npx',
        ['vitest', 'run', '--config', 'tools/perf/vitest.config.ts', '-t', `${scenario} —`],
        path,
        join(logs, `ab-${scenario}-${pair}.log`),
        { PERF_LAUNCHES: '1', PERF_RESULT: result, PERF_SCRATCH: scratch },
      );
      const decoded = decodeRunResult(JSON.parse(await readFile(result, 'utf8')));
      const scenarioResult = decoded?.scenarios[scenario];
      if (scenarioResult === undefined) throw new Error(`the other tree's ${scenario} wrote no result`);
      return scenarioResult;
    },
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
