import { AssetError } from '../../assetFiles';
import { buildScripts } from '../../scripts';
import type { BuildPlan } from '../buildPlan';

export interface PlannedScripts {
  /** The bundle's path in the build, or `null` when the project has no scripts. */
  file: string | null;
  count: number;
}

/**
 * The project's behaviours, compiled into one module beside the page.
 *
 * Compiled before anything is written, with the rest of the plan: a script that
 * does not compile used to be found after `assets/` and `scenes/` had already
 * been replaced, and the folder was left holding half of two builds.
 */
export async function planScripts(plan: BuildPlan, projectPath: string): Promise<PlannedScripts> {
  const scripts = await buildScripts(projectPath);
  if (scripts.errors.length > 0) {
    throw new AssetError(`Scripts did not compile:\n${scripts.errors.join('\n')}`);
  }
  if (scripts.scriptCount === 0) return { file: null, count: 0 };

  const file = 'scripts.mjs';
  plan.addBytes(file, scripts.code, { kind: 'scripts' });
  return { file, count: scripts.scriptCount };
}
