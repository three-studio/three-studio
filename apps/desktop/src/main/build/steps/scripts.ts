import { BUILD_LAYOUT } from '@three-studio/core';
import { AssetError } from '../../assetFiles';
import { buildScripts } from '../../scripts';
import { digestOf, type BuildPlan } from '../buildPlan';

export interface PlannedScripts {
  /** The bundle's path relative to `build.json`, or `null` when the project has no scripts. */
  file: string | null;
  count: number;
}

/**
 * The project's behaviours, compiled into one module, named by its content.
 *
 * Compiled before anything is written, with the rest of the plan: a script that
 * does not compile used to be found after `assets/` and `scenes/` had already
 * been replaced, and the folder was left holding half of two builds.
 *
 * By content, as every other file of the game is: a bundle with one fixed name
 * could be served from a visitor's cache beside a newer manifest, registering
 * behaviours the scenes no longer had.
 */
export async function planScripts(plan: BuildPlan, projectPath: string): Promise<PlannedScripts> {
  // Compiled for strangers: no source map, and no path from the author's disk.
  const scripts = await buildScripts(projectPath, 'export');
  if (scripts.errors.length > 0) {
    throw new AssetError(`Scripts did not compile:\n${scripts.errors.join('\n')}`);
  }
  if (scripts.scriptCount === 0) return { file: null, count: 0 };

  const data = Buffer.from(scripts.code, 'utf8');
  const file = `scripts/bundle.${digestOf(data).sha256.slice(0, 8)}.mjs`;
  plan.addBytes(`${BUILD_LAYOUT.game}/${file}`, data, { kind: 'scripts' });
  return { file, count: scripts.scriptCount };
}
