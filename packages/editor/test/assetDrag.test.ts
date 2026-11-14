import { describe, expect, it } from 'vitest';
import { ASSET_DRAG_MIME, droppedAssetId } from '../src/assets/assetDrag';

/*
 * What a drop carries is text the browser hands over, and a drag can come from
 * anywhere: another window, another application, a page that set the same type
 * on purpose. A drop that carries no asset id is not a drop of an asset.
 */

const carrying = (data: Record<string, string>) => ({
  getData: (type: string) => data[type] ?? '',
});

describe('the asset a drop carries', () => {
  it('is the id the Project panel put there', () => {
    expect(droppedAssetId(carrying({ [ASSET_DRAG_MIME]: 'tex-brick' }))).toBe('tex-brick');
  });

  it('is nothing when the payload is empty, as a drag that carries something else is', () => {
    expect(droppedAssetId(carrying({}))).toBeNull();
    expect(droppedAssetId(carrying({ [ASSET_DRAG_MIME]: '' }))).toBeNull();
  });

  it('is nothing for a drag with no data at all', () => {
    expect(droppedAssetId(null)).toBeNull();
    expect(droppedAssetId(undefined)).toBeNull();
  });
});
