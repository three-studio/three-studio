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
  /** A line of progress, printed as the run goes. */
  readonly say: (line: string) => void;
}

export type Scenario = (context: ScenarioContext) => Promise<ScenarioResult>;
