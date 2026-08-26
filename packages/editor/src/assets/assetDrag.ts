import type { AssetEntry, AssetKind } from '@three-studio/core';

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
 */
export function assetKindMime(kind: AssetKind): string {
  return `application/x-studio-asset-kind-${kind}`;
}

/** Sets every payload an asset drag can be read through. */
export function setAssetDragPayload(dataTransfer: DataTransfer, asset: AssetEntry): void {
  dataTransfer.setData(ASSET_DRAG_MIME, asset.id);
  dataTransfer.setData(ASSET_PATH_MIME, asset.path);
  dataTransfer.setData(assetKindMime(asset.kind), asset.id);
  dataTransfer.effectAllowed = 'copyMove';
}
