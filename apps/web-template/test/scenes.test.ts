import { describe, expect, it } from 'vitest';
import { entrySceneName, sceneOf } from '../src/scenes';

/*
 * A build lists every scene with its id, its name and its path; the name is the
 * alias a script uses when it holds what an author called a level instead.
 *
 * The bug the second half pins had the worst shape a bug can have: it worked
 * while the script was being written and broke the moment it shipped.
 * `scenes.current` was `main` in the editor and `scene` in a build, because the
 * exporter renamed the entry scene to `scene.json` and the player read the name
 * back off that file name. A script guarding on `scenes.current === 'main'` was
 * correct in play mode and wrong in the thing people download.
 */

const BUILD = {
  scenes: [
    { id: 's-main', name: 'main', path: 'scenes/main.1a2b3c4d.json' },
    { id: 's-boss', name: 'Boss', path: 'scenes/boss.5e6f7a8b.json' },
    // Another folder's scene under the entry's name: the entry keeps it.
    { id: 's-other', name: 'main', path: 'scenes/main.9c0d1e2f.json' },
  ],
};

describe('naming a scene in a build', () => {
  it('takes an id as itself', () => {
    expect(sceneOf(BUILD, 's-boss').path).toBe('scenes/boss.5e6f7a8b.json');
  });

  it('resolves a name, and the first scene under it keeps it', () => {
    expect(sceneOf(BUILD, 'Boss').id).toBe('s-boss');
    expect(sceneOf(BUILD, 'main').id).toBe('s-main');
  });

  it('prefers an id to a name that happens to spell it', () => {
    const build = {
      scenes: [
        { id: 'a', name: 'b', path: 'scenes/b.json' },
        { id: 'b', name: 'other', path: 'scenes/other.json' },
      ],
    };
    expect(sceneOf(build, 'b').id).toBe('b');
  });

  it('says the scene is missing rather than fetching a missing file', () => {
    expect(() => sceneOf(BUILD, 'Level9')).toThrow(/no scene named "Level9"/);
  });

  it('reads `constructor` as a name, not as something every object has', () => {
    expect(() => sceneOf(BUILD, 'constructor')).toThrow(/no scene named "constructor"/);
  });
});

describe('the name a build calls its entry scene', () => {
  it('is the name an author gave it, not the file it landed in', () => {
    // The editor runs the scene under its name, so a build has to answer with
    // the name too or `scenes.current` reads differently once it ships.
    expect(entrySceneName(BUILD)).toBe('main');
  });

  it('does not fail on a build with no scenes listed', () => {
    expect(entrySceneName({ scenes: [] })).toBe('');
  });
});
