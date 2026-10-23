import {
  BUILD_LAYOUT,
  serializeScene,
  type BuildScene,
  type SceneDoc,
  type SceneEntry,
} from '@three-studio/core';
import { digestOf, type BuildPlan } from '../buildPlan';

/**
 * The scenes a profile ships, entry point first, each named by its content.
 *
 * As in Unity's Scenes In Build: the first is where the game starts, and the
 * rest ship for a script to load later. The manifest lists each one's path, so
 * the player looks it up rather than working it out.
 *
 * **By content**, as every other file of the game is: a scene used to be
 * `scenes/<id>.json` for ever, so a visitor whose cache still held last week's
 * could be served it beside this week's manifest — a level that no longer
 * matched the assets around it.
 *
 * **Not by id.** The id comes from the scene's own file, and used as a path it
 * was a path: `"id": "../../x"` wrote two folders above the build. The file is
 * named after the scene, for whoever opens the folder, and the hash beside the
 * name is what makes it unique.
 */
export function planScenes(
  plan: BuildPlan,
  scenes: readonly { entry: SceneEntry; scene: SceneDoc }[],
): BuildScene[] {
  return scenes.map(({ entry, scene }) => {
    const data = Buffer.from(serializeScene(scene), 'utf8');
    const path = `scenes/${slugOf(entry.name)}.${digestOf(data).sha256.slice(0, 8)}.json`;
    plan.addBytes(`${BUILD_LAYOUT.game}/${path}`, data, { kind: 'scene', sceneId: entry.id });
    return { id: entry.id, name: entry.name, path };
  });
}

/**
 * A scene's name as a file name: lower-case ASCII letters and digits, words
 * joined by `-` — `Level 1: La Forêt` is `level-1-la-foret`.
 *
 * Only readable, never relied on: the hash beside it is what makes the path
 * unique. Plain enough that no volume, host or Jekyll reads it as anything else.
 */
export function slugOf(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 48)
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'scene' : slug;
}
