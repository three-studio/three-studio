import { describe, expect, it } from 'vitest';
import { encodePath } from '../src/urls';

/*
 * The exporter writes file names, and the player fetches URLs. They are not the
 * same alphabet: a texture called `brick wall #2.png` is a perfectly ordinary
 * asset and a URL that stops at the `#`, taking the extension with it. The
 * editor's resolver has always encoded; the web player was the one that did
 * not, and the failure is a missing texture with nothing in the console.
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
