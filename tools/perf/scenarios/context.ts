import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ScenarioResult } from '../report/results';

/** What a scenario is handed by `run.ts`. */
export interface ScenarioContext {
  readonly repo: string;
  /** The run's folder: projects, application data, logs and exports go inside it. */
  readonly runDir: string;
  /** Measured launches per scenario: `PERF_LAUNCHES`, three unless it says otherwise. */
  readonly launches: number;
  /** Where captures go (`PERF_SHOTS`), or `null` for none. */
  readonly shots: string | null;
  /**
   * Keep each scenario's prepared projects for this tree's next run: set for a
   * named `PERF_SCRATCH`, which is how an A/B runs each tree one launch at a time.
   */
  readonly keep: boolean;
  /** A line of progress, printed as the run goes. */
  readonly say: (line: string) => void;
}

export type Scenario = (context: ScenarioContext) => Promise<ScenarioResult>;

/** A scenario's folder in the run, where its projects and its kept subject live. */
export function scenarioFolder(context: ScenarioContext, id: string): string {
  return join(context.runDir, 'projects', id);
}

/**
 * A scenario's subject — its projects written, what was read of them, its
 * warm-up launch made — prepared once.
 *
 * When the run keeps its folder, the subject is written beside its projects
 * and read back by this tree's next run, which goes straight to its measured
 * launches: an A/B, one launch at a time and alternating with the other tree,
 * pays for each tree's preparation once. A subject that does not read back —
 * none yet, or one an older harness wrote — is made again.
 */
export async function prepared<T>(
  context: ScenarioContext,
  id: string,
  make: (folder: string) => Promise<T>,
  decode: (value: unknown) => T,
): Promise<T> {
  const folder = scenarioFolder(context, id);
  const file = join(folder, 'subject.json');
  if (context.keep) {
    try {
      const kept: unknown = JSON.parse(await readFile(file, 'utf8'));
      return decode(kept);
    } catch {
      // Not prepared yet, or by another harness: prepared again below.
    }
  }
  await rm(folder, { recursive: true, force: true });
  await mkdir(folder, { recursive: true });
  const subject = await make(folder);
  if (context.keep) await writeFile(file, JSON.stringify(subject));
  return subject;
}

/** A scenario's projects removed once it is done, unless the run keeps them. */
export async function finished(context: ScenarioContext, id: string): Promise<void> {
  if (!context.keep) await rm(scenarioFolder(context, id), { recursive: true, force: true });
}
