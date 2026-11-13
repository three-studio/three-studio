import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { conditionsNow, freeBytes } from './report/conditions';

/*
 * A performance run: the scenarios, one after another, against the production
 * build `npm run perf` has just made. Started by `tools/perf/vitest.config.ts`,
 * one `it` per scenario; see the README.
 *
 * Everything the run makes — projects, application data, logs, exports — goes
 * in one folder: `$TMPDIR/three-studio-perf/<run>/`, or `PERF_SCRATCH`. It is
 * removed at the end of a run that succeeded and kept, and named, when one
 * failed; a folder `PERF_SCRATCH` named is always kept.
 */

const exec = promisify(execFile);
const repo = fileURLToPath(new URL('../..', import.meta.url));

/** The space the biggest scenario needs at its peak, with room to spare: below it, nothing is written. */
const MINIMUM_FREE_BYTES = 3 * 1024 ** 3;

/** Every process whose command line names the run's folder: the editors and Chromes it launched. */
async function processesIn(runDir: string): Promise<string[]> {
  try {
    return (await exec('pgrep', ['-fl', runDir])).stdout.trim().split('\n').filter((line) => line !== '');
  } catch {
    return [];
  }
}

describe('a performance run', () => {
  const named = process.env['PERF_SCRATCH'];
  const runDir = named ?? join(tmpdir(), 'three-studio-perf', new Date().toISOString().replace(/[:.]/g, '-'));
  let caffeinate: ChildProcess | null = null;
  let failed = false;

  beforeAll(async () => {
    const free = await freeBytes(runDir);
    if (free < MINIMUM_FREE_BYTES) {
      throw new Error(`${(free / 1024 ** 3).toFixed(1)} GB free where the run would write; it needs 3 GB.`);
    }
    await mkdir(runDir, { recursive: true });
    // The display kept awake for as long as this worker lives: a sleeping
    // display stops the frames being measured.
    caffeinate = spawn('caffeinate', ['-dimsu', '-w', String(process.pid)], { stdio: 'ignore' });
  });

  beforeEach(({ onTestFailed }) => {
    onTestFailed(() => {
      failed = true;
    });
  });

  afterAll(async () => {
    caffeinate?.kill();
    // Nothing may outlive the run. A launch ends its own process group; what
    // is found here is a launch that did not, and it is ended and named.
    const left = await processesIn(runDir);
    if (left.length > 0) await exec('pkill', ['-f', runDir]).catch(() => undefined);
    if (failed || named !== undefined || left.length > 0) {
      process.stdout.write(`[perf] the run's folder is kept: ${runDir}\n`);
    } else {
      await rm(runDir, { recursive: true, force: true });
    }
    if (left.length > 0) throw new Error(`processes outlived the run:\n${left.join('\n')}`);
  });

  it('records the conditions it runs in', async () => {
    const conditions = await conditionsNow(repo);
    await writeFile(join(runDir, 'conditions.json'), `${JSON.stringify(conditions, null, 2)}\n`);
    process.stdout.write(`[perf] ${JSON.stringify(conditions)}\n`);
  });
});
