import { describe, expect, it } from 'vitest';
import { entrySceneName } from '../src/entryScene';

/*
 * The bug this pins had the worst shape a bug can have: it worked while the
 * script was being written and broke the moment it shipped.
 *
 * `scenes.current` was `main` in the editor and `scene` in a build, because the
 * exporter renames the entry scene to `scene.json` and the player read the name
 * back off that file name. A script guarding on `scenes.current === 'main'` was
 * correct in play mode and wrong in the thing people download.
 */

describe('the name a build calls its entry scene', () => {
  it('reads it from the exporter’s map, not from the renamed file', () => {
    const name = entrySceneName({
      scenes: ['scene.json', 'scenes/Boss.scene.json'],
      sceneMap: { main: 'scene.json', Boss: 'scenes/Boss.scene.json' },
    });
    // `sceneName('scene.json')` is `scene`, which is what this used to answer.
    expect(name).toBe('main');
  });

  it('names the scenes that were not renamed by their own name too', () => {
    const name = entrySceneName({
      scenes: ['scenes/Boss.scene.json'],
      sceneMap: { main: 'scene.json', Boss: 'scenes/Boss.scene.json' },
    });
    expect(name).toBe('Boss');
  });

  it('falls back to the file name for a build written before the map existed', () => {
    // Older builds have no `sceneMap`; the old behaviour is all there is.
    expect(entrySceneName({ scenes: ['scene.json'] })).toBe('scene');
  });

  it('does not fail on a build with no scenes listed', () => {
    expect(entrySceneName({ scenes: [] })).toBe('scene');
  });
});
