import { describe, expect, it } from 'vitest';
import { embeddedImageSource } from '../src/assets/loadModel';

/*
 * Which of a glTF's textures have to avoid `fetch`.
 *
 * `ImageBitmapLoader` loads an image by making an object URL for it and
 * fetching that URL, and Chromium refuses that fetch for a large blob — a bare
 * `TypeError: Failed to fetch`, which three turns into a `null` texture and a
 * grey model. Measured: a 24 MiB blob fetches, a 28 MiB one does not, and a
 * museum scan with two 40 MB JPEGs inside it arrives with no maps at all.
 *
 * Only the embedded images are affected, because they are the only ones that
 * become blobs. This is that question, on its own, where a test can ask it —
 * inside the loader callback it is unreachable.
 */

describe('an image stored in the file', () => {
  it('is claimed, because it is the one that becomes a blob', () => {
    const json = { textures: [{ source: 0 }], images: [{ bufferView: 3 }] };
    expect(embeddedImageSource(json, 0)).toBe(0);
  });

  it('is found through the texture, not by position', () => {
    // `source` is an index into `images`, and the two lists have no reason to
    // line up: one image serves several textures as soon as a material reuses a
    // map with different sampler settings.
    const json = {
      textures: [{ source: 1 }, { source: 1 }],
      images: [{ uri: 'wood.png' }, { bufferView: 7 }],
    };
    expect(embeddedImageSource(json, 0)).toBe(1);
    expect(embeddedImageSource(json, 1)).toBe(1);
  });
});

describe('everything else is left to three', () => {
  it('an image with a URI, which is fetched by URL and never wrapped', () => {
    const json = { textures: [{ source: 0 }], images: [{ uri: 'bark.png' }] };
    expect(embeddedImageSource(json, 0)).toBeNull();
  });

  it('a texture naming no source at all', () => {
    // What a texture declaring KTX2, WebP or AVIF looks like: the source lives
    // under `extensions`, and three's own plugins — registered in its
    // constructor, so ahead of this one — have already claimed it.
    const json = { textures: [{}], images: [{ bufferView: 0 }] };
    expect(embeddedImageSource(json, 0)).toBeNull();
  });

  it('a source index no image answers to', () => {
    expect(embeddedImageSource({ textures: [{ source: 4 }], images: [] }, 0)).toBeNull();
  });

  it('a document with no textures or no images', () => {
    expect(embeddedImageSource({}, 0)).toBeNull();
    expect(embeddedImageSource({ textures: [{ source: 0 }] }, 0)).toBeNull();
  });
});
