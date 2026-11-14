import { isAssetId, type AssetEntry, type AssetId, type AssetKind } from '@three-studio/core';

/** Carries the asset id; read on drop by the viewport and by inspector fields. */
export const ASSET_DRAG_MIME = 'application/x-studio-asset';
/** Carries the project-relative path; used when dropping onto a folder. */
export const ASSET_PATH_MIME = 'application/x-studio-asset-path';

/**
 * A type per asset kind, carrying no payload.
 *
 * `dragover` is the only place a target can accept or refuse a drop, and there
 * the browser exposes `dataTransfer.types` but not the data behind them — for
 * good reason, since a page should not read what is being dragged over it
 * until it is dropped. Putting the kind in the type name is what lets a texture
 * slot light up for a texture and stay inert for a model.
 *
 * Lowercased, because a browser lowers a drag's formats both in `setData` and
 * in `types`: a kind of two words, `physicsMaterial`, kept its capital here
 * and its slot never accepted its tile.
 */
export function assetKindMime(kind: AssetKind): string {
  return `application/x-studio-asset-kind-${kind.toLowerCase()}`;
}

/** Sets every payload an asset drag can be read through. */
export function setAssetDragPayload(dataTransfer: DataTransfer, asset: AssetEntry): void {
  dataTransfer.setData(ASSET_DRAG_MIME, asset.id);
  dataTransfer.setData(ASSET_PATH_MIME, asset.path);
  dataTransfer.setData(assetKindMime(asset.kind), asset.id);
  dataTransfer.effectAllowed = 'copyMove';
}

/**
 * The asset a drop carries, or `null` when what it carries is no asset's id.
 *
 * What a drop holds is text the browser hands over, and a drag can come from
 * anywhere: another window, another application, a page that set the same type
 * on purpose. So it is checked as the id it has to be, here, by the one reader
 * the viewport and the inspector's fields share.
 */
export function droppedAssetId(
  dataTransfer: Pick<DataTransfer, 'getData'> | null | undefined,
): AssetId | null {
  const text = dataTransfer?.getData(ASSET_DRAG_MIME);
  return isAssetId(text) ? text : null;
}
