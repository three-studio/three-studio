import { execFile } from 'node:child_process';
import { readFile, statfs } from 'node:fs/promises';
import { loadavg, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { isRecord } from '@three-studio/core';
import { electronBinary } from '../launch/electron';

/*
 * What a run ran on and under. A comparison between two runs is only worth
 * anything when these agree — another machine, another Chromium, the Mac on
 * battery or in Low Power Mode, all move the timings — so every run records
 * them, and the comparison reads them first.
 */

const run = promisify(execFile);

async function output(command: string, args: readonly string[], env?: Record<string, string>): Promise<string> {
  try {
    return (await run(command, args, { env: env === undefined ? process.env : { ...process.env, ...env } })).stdout.trim();
  } catch {
    return 'unknown';
  }
}

async function packageVersion(repo: string, name: string): Promise<string> {
  const parsed: unknown = JSON.parse(await readFile(join(repo, 'node_modules', name, 'package.json'), 'utf8'));
  return isRecord(parsed) && typeof parsed['version'] === 'string' ? parsed['version'] : 'unknown';
}

/** `pmset -g batt`'s first line names the source: "Now drawing from 'AC Power'". */
export function powerSource(pmsetBatt: string): string {
  return /drawing from '([^']+)'/.exec(pmsetBatt)?.[1] ?? 'unknown';
}

/** `pmset -g` lists `lowpowermode 1` when it is on. */
export function lowPowerModeOn(pmset: string): boolean {
  return /^\s*lowpowermode\s+1\b/m.test(pmset);
}

export interface RunConditions {
  readonly machine: string;
  readonly os: string;
  readonly node: string;
  readonly electron: string;
  /** The Chromium inside Electron, which is what renders the editor. */
  readonly chromium: string;
  /** The Chrome an exported build is opened in. */
  readonly chrome: string;
  readonly three: string;
  readonly commit: string;
  /** A tracked file differs from the commit. Untracked files say nothing: the skill folders are never tracked. */
  readonly trackedChanges: boolean;
  readonly power: string;
  readonly lowPowerMode: boolean;
  /** One, five and fifteen minutes. */
  readonly loadAverage: readonly number[];
}

export async function conditionsNow(repo: string): Promise<RunConditions> {
  const memory = `${Math.round(totalmem() / 1024 ** 3)} GB`;
  return {
    machine: `${await output('sysctl', ['-n', 'machdep.cpu.brand_string'])}, ${memory}`,
    os: `macOS ${await output('sw_vers', ['-productVersion'])} (${await output('sw_vers', ['-buildVersion'])})`,
    node: process.version,
    electron: await packageVersion(repo, 'electron'),
    chromium: await output(await electronBinary(repo), ['-p', 'process.versions.chrome'], { ELECTRON_RUN_AS_NODE: '1' }),
    chrome: (await output('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--version'])).replace(
      /^Google Chrome\s*/,
      '',
    ),
    three: await packageVersion(repo, 'three'),
    commit: await output('git', ['-C', repo, 'rev-parse', '--short', 'HEAD']),
    trackedChanges: (await output('git', ['-C', repo, 'status', '--porcelain', '--untracked-files=no'])) !== '',
    power: powerSource(await output('pmset', ['-g', 'batt'])),
    lowPowerMode: lowPowerModeOn(await output('pmset', ['-g'])),
    loadAverage: loadavg().map((load) => Math.round(load * 100) / 100),
  };
}

/** Bytes free to this user on the volume holding `path`, or on its nearest existing parent's. */
export async function freeBytes(path: string): Promise<number> {
  for (let at = path; ; at = dirname(at)) {
    try {
      const volume = await statfs(at);
      return volume.bavail * volume.bsize;
    } catch (error) {
      if (dirname(at) === at) throw error;
    }
  }
}
