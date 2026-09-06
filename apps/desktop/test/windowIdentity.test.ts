import { describe, expect, it } from 'vitest';
import { windowIdentity } from '../src/preload/windowIdentity';

/*
 * What a window is, decided before the first render.
 *
 * The preload had no test, and this is the only decision in it: everything else
 * there is one line per IPC channel. It reads two globals inside a file that
 * imports `electron`, so checking any of it meant launching the application —
 * and the case the comment already named, a value containing `=`, had never
 * been run.
 */

const editorOf = (projectPath: string): readonly string[] => [
  '/path/to/Electron',
  '--studio-role=editor',
  `--studio-project=${projectPath}`,
];

describe('what a window was told it is', () => {
  it('reads the role and the project out of argv', () => {
    expect(windowIdentity(editorOf('/projects/Races'), '')).toEqual({
      windowRole: 'editor',
      projectPath: '/projects/Races',
      sceneId: null,
    });
  });

  it('keeps an = that belongs to the value', () => {
    // Only the first one separates: a project path may contain `=`, and cutting
    // at the last would hand the editor half a path and no way to say so.
    expect(windowIdentity(editorOf('/projects/a=b/Races'), '').projectPath).toBe(
      '/projects/a=b/Races',
    );
  });

  it('does not answer a question about a name that merely starts the same', () => {
    // The `=` in the prefix is what does this: `--studio-projector` is not
    // `--studio-project`, and a prefix match without it would say it was.
    const argv = ['--studio-role=editor', '--studio-projector=/nowhere'];
    expect(windowIdentity(argv, '').projectPath).toBeNull();
  });

  it('has no project when argv names none', () => {
    // The launcher window: it is what picks one.
    expect(windowIdentity(['--studio-role=launcher'], '').projectPath).toBeNull();
  });
});

describe('the scene, which travels in the URL', () => {
  it('reads it from the query string', () => {
    // Not argv, because `webContents.reload()` replays argv verbatim and the
    // scene is the one thing about a window that changes. See ADR-0008.
    expect(windowIdentity(editorOf('/projects/Races'), '?scene=KnnOIzJdX1KB').sceneId).toBe(
      'KnnOIzJdX1KB',
    );
  });

  it('picks its own key out of a query carrying others', () => {
    expect(windowIdentity([], '?other=1&scene=Boss&more=2').sceneId).toBe('Boss');
  });

  it('is null when the window opens on the start scene', () => {
    expect(windowIdentity([], '').sceneId).toBeNull();
    expect(windowIdentity([], '?other=1').sceneId).toBeNull();
  });
});

describe('a role that is not one', () => {
  /*
   * Anything that is not a role is the launcher, which is the recoverable half
   * of getting this wrong: a window with no project showing the picker is a
   * click away from being useful, and one coming up in the editor with nothing
   * to edit is not.
   */

  it('falls back when argv names no role at all', () => {
    expect(windowIdentity([], '').windowRole).toBe('launcher');
  });

  it('falls back on a role nobody declares', () => {
    // This is the one the old cast let through: `Root.tsx` asks
    // `=== 'launcher'`, so every other string — a typo included — rendered the
    // editor shell.
    expect(windowIdentity(['--studio-role=editr'], '').windowRole).toBe('launcher');
    expect(windowIdentity(['--studio-role='], '').windowRole).toBe('launcher');
  });

  it('falls back on a name borrowed from somewhere else', () => {
    // `in` walks the prototype chain and said yes to both, so the window came
    // up as an editor. `Object.hasOwn` is what asks the record and nothing
    // above it. Written as `in` first, and this is the test that said so.
    expect(windowIdentity(['--studio-role=toString'], '').windowRole).toBe('launcher');
    expect(windowIdentity(['--studio-role=constructor'], '').windowRole).toBe('launcher');
  });

  it('keeps a role that is one', () => {
    expect(windowIdentity(['--studio-role=editor'], '').windowRole).toBe('editor');
    expect(windowIdentity(['--studio-role=launcher'], '').windowRole).toBe('launcher');
  });
});
