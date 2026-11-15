import { basePathProblem, normalizeBasePath } from '../src/index';
import { describe, expect, it } from 'vitest';

/*
 * A base URL is one string that decides where every file in an exported build
 * is looked for. Getting it slightly wrong — a missing slash — does not produce
 * a slightly wrong build, it produces a folder of 404s, so the two rules that
 * turn what an author types into that string are worth pinning.
 */

describe('normalizeBasePath', () => {
  it('reads "", "." and "./" as the same thing', () => {
    // All three say "relative to the document", which is what the untagged page
    // already does. Collapsing them keeps the exported page byte for byte what
    // it was before this field existed.
    for (const raw of ['', '.', './', '   ', ' ./ ']) {
      expect(normalizeBasePath(raw)).toBe('');
    }
  });

  it('adds the trailing slash, and only when it is missing', () => {
    // `/games/demo` resolves `assets/x.png` to `/games/assets/x.png`: the last
    // segment of a base without a slash is treated as a file name, not a
    // folder. Vite's own `base` enforces this for the same reason.
    expect(normalizeBasePath('/games/demo')).toBe('/games/demo/');
    expect(normalizeBasePath('http://localhost:8080')).toBe('http://localhost:8080/');
    expect(normalizeBasePath('//cdn.example.com')).toBe('//cdn.example.com/');

    expect(normalizeBasePath('/')).toBe('/');
    expect(normalizeBasePath('/games/demo/')).toBe('/games/demo/');
  });
});

describe('basePathProblem', () => {
  it('accepts every shape a build is actually served from', () => {
    const fine = ['', '.', '/', '/games/demo/', 'http://localhost:8080', '//cdn.example.com'];
    for (const raw of fine) {
      expect(basePathProblem(raw)).toBeNull();
    }
  });

  it('refuses a query or a fragment', () => {
    // Normalizing would run straight through them and append a slash after the
    // query, producing a request for a path that cannot exist.
    expect(basePathProblem('http://host/app?v=1')).toMatch(/query or a fragment/);
    expect(basePathProblem('/app#start')).toMatch(/query or a fragment/);
  });

  it('refuses what an HTML attribute cannot carry', () => {
    // Escaped rather than refused, a quote would produce a quietly broken URL
    // instead of a message the author can read.
    expect(basePathProblem('/a b/')).toMatch(/spaces, quotes/);
    expect(basePathProblem('/a"b/')).toMatch(/spaces, quotes/);
    expect(basePathProblem('/a<b/')).toMatch(/spaces, quotes/);
  });
});
