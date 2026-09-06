import { beforeEach, describe, expect, it } from 'vitest';
import {
  adoptProject,
  currentProject,
  forgetWindow,
  isDirty,
  noteExport,
  releaseProject,
  requireProject,
  setDirty,
  wasExported,
} from '../src/main/session';

/*
 * What the main process remembers between calls, and the two refusals built on
 * it.
 *
 * These rules lived in `ipc.ts`, behind `import { ipcMain } from 'electron'`,
 * and nothing exercised them: the file had no test at all, and neither of the
 * refusals below had ever been run outside a real app. Both are the whole of
 * what stands between a renderer and a path of its own choosing.
 */

beforeEach(() => {
  // Module state, so each test says where it starts from. The dirty flags and
  // the export tokens are keyed, and every test below uses keys of its own.
  releaseProject();
});

describe('the open project', () => {
  it('refuses to name one when none is open', () => {
    expect(() => requireProject()).toThrow('No project is open.');
    expect(currentProject()).toBeNull();
  });

  it('hands back the one that was opened', () => {
    adoptProject('/projects/Races');
    expect(requireProject()).toBe('/projects/Races');
    expect(currentProject()).toBe('/projects/Races');
  });

  it('refuses again once it is closed', () => {
    // The refusal that matters more than the answer: a request arriving after
    // the project closed must not be resolved against the one before it.
    adoptProject('/projects/Races');
    releaseProject();
    expect(() => requireProject()).toThrow('No project is open.');
  });

  it('follows the last project opened', () => {
    adoptProject('/projects/Races');
    adoptProject('/projects/Platformer');
    expect(requireProject()).toBe('/projects/Platformer');
  });
});

describe('unsaved work', () => {
  it('is not claimed for a window nobody has spoken for', () => {
    expect(isDirty(9001)).toBe(false);
  });

  it('answers per window, which is the whole reason it is a map', () => {
    // One boolean was enough with one editor window. With two it named
    // whichever renderer spoke last, so the close guard would throw away
    // another window's work or block this one over a document it does not hold.
    setDirty(1, true);
    setDirty(2, false);
    expect(isDirty(1)).toBe(true);
    expect(isDirty(2)).toBe(false);
  });

  it('forgets a window that is gone', () => {
    // A `webContents.id` is not reused within a run, but a window reloaded onto
    // another scene comes back through here — and coming back dirty would block
    // its own close over a document it no longer holds.
    setDirty(3, true);
    forgetWindow(3);
    expect(isDirty(3)).toBe(false);
  });
});

describe('the folders this session produced', () => {
  it('refuses one it never handed back', () => {
    // The renderer naming a path and the main process opening it in the file
    // manager is a hole. This is the token that closes it.
    expect(wasExported('/tmp/somewhere-else')).toBe(false);
  });

  it('accepts one it did', () => {
    noteExport('/builds/Races');
    expect(wasExported('/builds/Races')).toBe(true);
  });

  it('compares the whole path, not a prefix of it', () => {
    // `startsWith` here would hand back the parent of every export, and the
    // parent of a build folder is usually somebody's home directory.
    noteExport('/builds/Races');
    expect(wasExported('/builds')).toBe(false);
    expect(wasExported('/builds/Races/dist')).toBe(false);
  });
});
