import { describe, expect, it } from 'vitest';
import { entrySceneName, sceneIdOf } from '../src/scenes';

/*
 * A build addresses every scene by id; `sceneNames` is the alias a script uses
 * when it holds the name an author gave a level instead.
 *
 * The bug the second half pins had the worst shape a bug can have: it worked
 * while the script was being written and broke the moment it shipped.
 * `scenes.current` was `main` in the editor and `scene` in a build, because the
 * exporter renamed the entry scene to `scene.json` and the player read the name
 * back off that file name. A script guarding on `scenes.current === 'main'` was
 * correct in play mode and wrong in the thing people download.
 */

const BUILD = {
  scenes: ['s-main', 's-boss'],
  sceneNames: { main: 's-main', Boss: 's-boss' },
};

describe('naming a scene in a build', () => {
  it('takes an id as itself', () => {
    expect(sceneIdOf(BUILD, 's-boss')).toBe('s-boss');
  });

  it('resolves a name through the alias table', () => {
    expect(sceneIdOf(BUILD, 'Boss')).toBe('s-boss');
  });

  it('says the scene is missing rather than fetching a missing file', () => {
    // `scenes/undefined.json` would report a missing file, which is a different
    // thing from a scene this build does not have.
    expect(() => sceneIdOf(BUILD, 'Level9')).toThrow(/no scene named "Level9"/);
  });
});

describe('the name a build calls its entry scene', () => {
  it('reads it from the alias table, not from the file it landed in', () => {
    // The editor runs the scene under its name, so a build has to answer with
    // the name too or `scenes.current` reads differently once it ships.
    expect(entrySceneName(BUILD)).toBe('main');
  });

  it('falls back to the id for a scene the table forgot', () => {
    expect(entrySceneName({ scenes: ['s-orphan'], sceneNames: {} })).toBe('s-orphan');
  });

  it('does not fail on a build with no scenes listed', () => {
    expect(entrySceneName({ scenes: [] })).toBe('');
  });
});
