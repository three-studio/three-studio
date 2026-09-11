import { describe, expect, it } from 'vitest';
import {
  isSceneOpenElsewhere,
  leftWithNothing,
  needsDiscardPrompt,
  planOpenEditor,
  planSceneWindow,
  planSwitchScene,
  type OpenScene,
} from '../src/main/windowPolicy';

/*
 * The rules that move between windows, run without any.
 *
 * `windows.ts` had no test, and it is all policy: which window a request goes
 * to, when the picker comes back, when unsaved work has to be confirmed away.
 * Every one of those was written inside a `BrowserWindow` callback, so checking
 * one meant launching the application and clicking.
 */

const editor = (contentsId: number, sceneId: string | null, projectPath = '/Races'): OpenScene => ({
  projectPath,
  sceneId,
  contentsId,
});

describe('a scene open somewhere else', () => {
  it('is not open elsewhere when nothing shows it', () => {
    expect(isSceneOpenElsewhere([editor(1, 'main')], 1, 'Boss')).toBe(false);
  });

  it('is not open elsewhere when the window asking is the one showing it', () => {
    // Deleting the scene you are editing is your own business; the refusal is
    // about taking a file out from under somebody else.
    expect(isSceneOpenElsewhere([editor(1, 'Boss')], 1, 'Boss')).toBe(false);
  });

  it('is open elsewhere when another window shows it', () => {
    const editors = [editor(1, 'main'), editor(2, 'Boss')];
    expect(isSceneOpenElsewhere(editors, 1, 'Boss')).toBe(true);
  });
});

describe('opening a project', () => {
  it('builds a window when nothing is open', () => {
    expect(planOpenEditor([], '/Races')).toEqual({ do: 'build' });
  });

  it('focuses what is open when the project is already the open one', () => {
    const editors = [editor(1, 'main')];
    expect(planOpenEditor(editors, '/Races')).toEqual({ do: 'focus', entry: editors[0] });
  });

  it('focuses the window that already shows the scene', () => {
    // Never a second window onto the same scene: two documents over one file
    // means whichever saves last silently wins.
    const editors = [editor(1, 'main'), editor(2, 'Boss')];
    expect(planOpenEditor(editors, '/Races', 'Boss')).toEqual({ do: 'focus', entry: editors[1] });
  });

  it('builds one for a scene of the same project that nothing shows', () => {
    expect(planOpenEditor([editor(1, 'main')], '/Races', 'Boss')).toEqual({ do: 'build' });
  });

  it('replaces every window when the project is a different one', () => {
    // All editor windows share one project: the main process serves the asset
    // protocol from a single root, so a second project would be a second
    // process.
    expect(planOpenEditor([editor(1, 'main')], '/Platformer')).toEqual({ do: 'replace' });
  });

  it('does not count a window that has not said which scene it is on', () => {
    // The race this leaves open, written down rather than pretended away: a
    // window is built before its renderer reports a scene, so asking for that
    // scene in the moment between builds a second window onto it.
    expect(planOpenEditor([editor(1, null)], '/Races', 'Boss')).toEqual({ do: 'build' });
  });
});

describe('opening a scene in a window of its own', () => {
  it('does nothing when no project is open', () => {
    // Reached from inside an editor, so with none there is no project to name.
    expect(planSceneWindow([], 'Boss')).toEqual({ do: 'nothing' });
  });

  it('focuses the window that has it', () => {
    const editors = [editor(1, 'main'), editor(2, 'Boss')];
    expect(planSceneWindow(editors, 'Boss')).toEqual({ do: 'focus', entry: editors[1] });
  });

  it('builds one on the open project', () => {
    expect(planSceneWindow([editor(1, 'main')], 'Boss')).toEqual({
      do: 'build',
      projectPath: '/Races',
    });
  });
});

describe('pointing a window at another scene', () => {
  it('does nothing for a window the list does not know', () => {
    // A message from a renderer whose window has already gone.
    expect(planSwitchScene([editor(1, 'main')], 99, 'Boss')).toEqual({ do: 'nothing' });
  });

  it('brings forward the window that already has the scene', () => {
    const editors = [editor(1, 'main'), editor(2, 'Boss')];
    expect(planSwitchScene(editors, 1, 'Boss')).toEqual({ do: 'focus', entry: editors[1] });
  });

  it('reloads rather than focusing itself', () => {
    // Asked to switch to the scene it is already on, a window reloads — which
    // is what "reload this scene" would mean anyway.
    const editors = [editor(1, 'Boss')];
    expect(planSwitchScene(editors, 1, 'Boss')).toEqual({ do: 'reload', entry: editors[0] });
  });

  it('reloads the asking window onto a scene nothing shows', () => {
    const editors = [editor(1, 'main')];
    expect(planSwitchScene(editors, 1, 'Boss')).toEqual({ do: 'reload', entry: editors[0] });
  });
});

describe('being left with nothing', () => {
  const calm = { quitting: false, transitioning: false };

  it('is true once the last editor has gone', () => {
    // Closing the last scene is leaving the project, not leaving the editor.
    expect(leftWithNothing(0, calm)).toBe(true);
  });

  it('is false while an editor is still open', () => {
    expect(leftWithNothing(1, calm)).toBe(false);
  });

  it('is false during a quit', () => {
    // Otherwise a deliberate exit opens a window a few milliseconds before the
    // process dies — harmless when it really does die, and a window left on
    // screen when it does not.
    expect(leftWithNothing(0, { ...calm, quitting: true })).toBe(false);
  });

  it('is false in the middle of a project switch', () => {
    // A switch has a moment with no window at all, because a close may still be
    // cancelled and so has to finish before the replacement is built.
    expect(leftWithNothing(0, { ...calm, transitioning: true })).toBe(false);
  });
});

describe('confirming unsaved work away', () => {
  it('asks when there is work to lose', () => {
    expect(needsDiscardPrompt(true, false)).toBe(true);
  });

  it('does not ask when there is not', () => {
    expect(needsDiscardPrompt(false, false)).toBe(false);
  });

  it('does not ask the smoke harness, which cannot answer', () => {
    expect(needsDiscardPrompt(true, true)).toBe(false);
  });
});
