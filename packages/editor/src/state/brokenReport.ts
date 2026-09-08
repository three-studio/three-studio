import { findBrokenReferences } from '@three-studio/core';
import { useAssetStore } from './assetStore';
import { expandedScene } from './expansion';

/** Every asset id the project holds — materials and prefabs included. */
export function knownAssetIds(): ReadonlySet<string> {
  return new Set(useAssetStore.getState().manifest.assets.map((asset) => asset.id));
}

/** How many are named before the line stops naming them. */
const SHOWN = 5;

/**
 * Says once, on opening a scene, what it points at and cannot find.
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
export function reportBrokenReferences(): void {
  const scene = expandedScene().scene;
  const broken = findBrokenReferences(scene, knownAssetIds());
  if (broken.length === 0) return;

  const named = broken
    .slice(0, SHOWN)
    .map(({ entityId, assetId }) =>
      entityId === null
        ? `the environment → ${assetId}`
        : `${scene.entities[entityId]?.name ?? entityId} → ${assetId}`,
    )
    .join('; ');
  const rest = broken.length > SHOWN ? `, and ${broken.length - SHOWN} more` : '';

  console.warn(
    `[scene] ${broken.length} reference${broken.length === 1 ? '' : 's'} to assets this project ` +
      `does not have: ${named}${rest}. Models draw a placeholder; the rows are marked in the ` +
      `Hierarchy.`,
  );
}
