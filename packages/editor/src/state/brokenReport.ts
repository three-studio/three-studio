import {
  findBrokenReferences,
  findMissingEntities,
  findPrefabInstances,
  type AssetId,
  type CoreRegistries,
  type EntityId,
  type RefusedFile,
  type SceneDoc,
} from '@three-studio/core';
import { useAssetStore } from './assetStore';
import { expandedScene } from './expansion';

/** Every asset id the project holds — materials and prefabs included. */
export function knownAssetIds(): ReadonlySet<AssetId> {
  return new Set(useAssetStore.getState().manifest.assets.map((asset) => asset.id));
}

/**
 * What each row of the Hierarchy is marked with, by entity: the assets it
 * names that the project does not hold, the entities it names that the scene
 * does not have, and the prefab it places that this build refused to read —
 * left out of the library, so its instance draws empty, as a missing one's
 * does, and is marked beside it in words of its own: the file is there.
 *
 * One walk for the whole tree rather than one question per row: it is asked
 * for a list that can be four thousand rows long.
 */
export function brokenRows(
  registries: CoreRegistries,
  scene: SceneDoc,
  known: ReadonlySet<AssetId>,
  refusedPrefabs: ReadonlyMap<AssetId, RefusedFile>,
): Map<EntityId, string[]> {
  const assets = new Map<EntityId, string[]>();
  for (const { entityId, assetId } of findBrokenReferences(registries, scene, known)) {
    // The environment is not a row. It is reported at load and shown in the
    // Inspector; there is nothing here to mark.
    if (entityId === null) continue;
    assets.set(entityId, [...(assets.get(entityId) ?? []), assetId]);
  }
  const marks = new Map<EntityId, string[]>();
  const say = (entityId: EntityId, line: string) => marks.set(entityId, [...(marks.get(entityId) ?? []), line]);
  for (const [entityId, named] of assets) say(entityId, `Not in this project: ${named.join(', ')}`);
  for (const { entityId, type } of findMissingEntities(registries, scene)) {
    const label = registries.components.get(type)?.label ?? type;
    say(entityId, `Its ${label} names an entity this scene does not have`);
  }
  for (const [assetId, file] of refusedPrefabs) {
    for (const entityId of findPrefabInstances(assetId, scene)) say(entityId, `Its prefab could not be read: ${file.path}`);
  }
  return marks;
}

/** How many are named before the line stops naming them. */
const SHOWN = 5;

/**
 * Says once, on opening a scene, what it points at and cannot find — and again
 * on reverting it to its file, which can bring back what the session had dealt
 * with.
 *
 * There was already a report: `ModelSystem` caught `Unknown model asset` and
 * printed it with a stack, once per entity, as an error. Three barrels from a
 * deleted prop filled the console with three stack traces for a state the delete
 * dialog had announced in advance — and said nothing at all about a missing
 * texture or a missing sky, which throw nothing.
 *
 * One line, at the moment the author can act on it, naming the entities rather
 * than the ids: an id is what the file holds, a name is what the hierarchy
 * shows. `console.warn` because `captureConsole` is what puts it in the Console
 * panel, and this belongs beside the rest of what a scene said as it loaded.
 *
 * Called after the manifest has landed, never before: `refresh()` is what fills
 * it, and asking first would report every asset in the project as missing.
 */
export function reportBrokenReferences(registries: CoreRegistries): void {
  const scene = expandedScene(registries).scene;
  const broken = findBrokenReferences(registries, scene, knownAssetIds());
  if (broken.length === 0) return;

  const named = broken
    .slice(0, SHOWN)
    .map(({ entityId, assetId }) =>
      entityId === null
        ? `the environment → ${assetId}`
        : `${scene.entities.get(entityId)?.name ?? entityId} → ${assetId}`,
    )
    .join('; ');
  const rest = broken.length > SHOWN ? `, and ${broken.length - SHOWN} more` : '';

  console.warn(
    `[scene] ${broken.length} reference${broken.length === 1 ? '' : 's'} to assets this project ` +
      `does not have: ${named}${rest}. Models draw a placeholder; the rows are marked in the ` +
      `Hierarchy.`,
  );
}
