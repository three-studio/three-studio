import {
  DEFAULT_BUILD_PROFILE_ID,
  basePathProblem,
  createBuildProfiles,
  normalizeBasePath,
  normalizeBuildProfiles,
  type BuildProfiles,
} from '../src/index';
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

describe('normalizeBuildProfiles', () => {
  it('fills a field a profile predates and touches nothing else', () => {
    // The shape on disk before `basePath` existed. Read as-is it would export
    // `undefined` as a base, which is neither empty nor a URL.
    const stored = {
      active: 'custom',
      profiles: {
        custom: {
          name: 'Itch',
          target: 'web',
          scenes: ['scene-a'],
          outputDir: '/tmp/out',
          includeAllAssets: true,
          title: 'My Game',
        },
      },
    } as unknown as BuildProfiles;

    const filled = normalizeBuildProfiles(stored, 'Project');

    expect(filled.profiles['custom']?.basePath).toBe('');
    expect(filled.profiles['custom']).toMatchObject({
      name: 'Itch',
      scenes: ['scene-a'],
      outputDir: '/tmp/out',
      includeAllAssets: true,
      title: 'My Game',
    });
    // The active profile is the author's, not the factory's default.
    expect(filled.active).toBe('custom');
  });

  it('keeps values a factory default would otherwise have replaced', () => {
    // `outputDir: null` and `scenes: []` are meaningful answers, not missing
    // ones. A spread that read them as absent would silently reset a profile.
    const stored = createBuildProfiles('Project');
    expect(normalizeBuildProfiles(stored, 'Project')).toEqual(stored);
  });

  it('builds the default set when a project has no build section at all', () => {
    const filled = normalizeBuildProfiles(undefined, 'Project');
    expect(filled.active).toBe(DEFAULT_BUILD_PROFILE_ID);
    expect(filled.profiles[DEFAULT_BUILD_PROFILE_ID]?.title).toBe('Project');
    expect(filled.profiles[DEFAULT_BUILD_PROFILE_ID]?.basePath).toBe('');
  });
});
