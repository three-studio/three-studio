import { buildScenePath, serializeScene, type SceneDoc, type SceneEntry } from '@three-studio/core';
import { AssetError } from '../../assetFiles';
import { BuildPathError } from '../buildPath';
import type { BuildPlan } from '../buildPlan';

/**
 * The scenes a profile ships, each at `scenes/<id>.json`, entry point first.
 *
 * As in Unity's Scenes In Build: the first is where the game starts, and the
 * rest ship for a script to load later. A build is not a thing to hand-edit, so
 * the id wins and the path is derived from it.
 *
 * The id comes from the scene's own file, so it is checked like any name a
 * build holds: a file carrying `"id": "../../x"` used to be written outside the
 * output folder. A scene with no id of its own is addressed by its project path,
 * which can hold slashes — folders, which a build can hold.
 */
export function planScenes(
  plan: BuildPlan,
  scenes: readonly { entry: SceneEntry; scene: SceneDoc }[],
): void {
  for (const { entry, scene } of scenes) {
    try {
      plan.addBytes(buildScenePath(entry.id), serializeScene(scene), {
        kind: 'scene',
        sceneId: entry.id,
      });
    } catch (cause) {
      if (!(cause instanceof BuildPathError)) throw cause;
      throw new AssetError(
        `Scene "${entry.name}" cannot be exported: its id, "${entry.id}", is not a name a build can hold.`,
      );
    }
  }
}
