import { ASSET_HOST, ASSET_SCHEME, assetUrl, encodePath, importedAssetPath } from '@three-studio/core';
import { describe, expect, it } from 'vitest';

/*
 * The exporter writes file names, and the player fetches URLs. They are not the
 * same alphabet: a texture called `brick wall #2.png` is a perfectly ordinary
 * asset and a URL that stops at the `#`, taking the extension with it. The
 * editor's resolver has always encoded; the web player was the one that did
 * not, and the failure is a missing texture with nothing in the console.
 *
 * This was the only tested one of the four places that built such a URL. Now
 * that there is one place, this is its test.
 */

describe('encodePath', () => {
  it('encodes what a file name may contain and a URL may not', () => {
    expect(encodePath('textures/brick wall #2.png')).toBe('textures/brick%20wall%20%232.png');
    expect(encodePath('data/what?.json')).toBe('data/what%3F.json');
    expect(encodePath('models/été/scène.gltf')).toBe('models/%C3%A9t%C3%A9/sc%C3%A8ne.gltf');
  });

  it('leaves the separators alone', () => {
    // Encoding `/` would turn one path into one very long file name.
    expect(encodePath('a/b/c.png')).toBe('a/b/c.png');
    expect(encodePath('flat.png')).toBe('flat.png');
    expect(encodePath('')).toBe('');
  });

  it('encodes a percent that is part of the name', () => {
    // A file actually called `brick%20wall.png` is found at `brick%2520wall.png`
    // and nowhere else. This looks like double encoding and is the opposite:
    // encoding once is what survives the server decoding once.
    expect(encodePath('brick%20wall.png')).toBe('brick%2520wall.png');
  });
});

describe('assetUrl', () => {
  it('names the one host, and encodes the path', () => {
    expect(assetUrl('textures/brick wall #2.png')).toBe(
      `${ASSET_SCHEME}://${ASSET_HOST}/textures/brick%20wall%20%232.png`,
    );
  });

  it('is what the main process registers and serves', () => {
    // Spelled out rather than composed, because the string is the contract: it
    // is in the renderer's CSP and in `protocol.registerSchemesAsPrivileged`,
    // and a scheme renamed on one side alone is every asset failing to load.
    expect(ASSET_SCHEME).toBe('studio-asset');
    expect(ASSET_HOST).toBe('project');
  });
});

describe('where a scaled copy lives', () => {
  it('is invalidated by the source and by the answers, both written into the name', () => {
    // Nothing has to notice a change and clear anything: a different source, a
    // different Max Size or a different compression answer is simply a
    // different file, and the old one goes when the cache does.
    const one = importedAssetPath('asset-1', 'a'.repeat(64), '2048', '.glb');
    expect(importedAssetPath('asset-1', 'b'.repeat(64), '2048', '.glb')).not.toBe(one);
    expect(importedAssetPath('asset-1', 'a'.repeat(64), '4096', '.glb')).not.toBe(one);
    expect(importedAssetPath('asset-1', 'a'.repeat(64), '2048-c', '.glb')).not.toBe(one);
    expect(importedAssetPath('asset-2', 'a'.repeat(64), '2048', '.glb')).not.toBe(one);
  });

  it('stays under the cache, which the project gitignores and may delete', () => {
    // The version is in the name on purpose, so this expectation has to be
    // updated by hand when the pipeline changes what it produces. That is the
    // point: bumping it is a decision, and one that has to be visible.
    expect(importedAssetPath('asset-1', 'abcdef0123456789', '2048', '.png')).toBe(
      '.studio/imported/asset-1/abcdef012345-2048-v5.png',
    );
  });
});
