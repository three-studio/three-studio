import { describe, expect, it, vi } from 'vitest';
import { showPanel } from '../src/shell/dockApi';
import { panelForChange, watchPanelFocus, type FocusInputs } from '../src/shell/panelFocus';
import { useEditorStore } from '../src/state/editorStore';

vi.mock('../src/shell/dockApi', () => ({ showPanel: vi.fn() }));

/*
 * Bringing a panel forward is a reaction to a change of state, and it used to be
 * `commands/` doing it by hand: `startPlay` called `showPanel` itself, so the
 * command layer imported the shell and reached into the dock.
 *
 * Extracted from the subscription so it can be checked without a dock — the
 * decision is the part worth pinning, and the subscription around it is three
 * lines of plumbing.
 */

const state = (over: Partial<FocusInputs> = {}): FocusInputs => ({
  playing: false,
  revealed: null,
  sceneSettings: 0,
  console: 0,
  ...over,
});

describe('what a change of state brings forward', () => {
  it('shows the Viewport when the game starts, and nothing when it stops', () => {
    // The Viewport is where the game plays, so it comes forward — reopened if
    // it was closed. At Stop the game simply gives way to the edit view in the
    // same panel, and the dock has nothing to bring back.
    expect(panelForChange(state(), state({ playing: true }))).toBe('viewport');
    expect(panelForChange(state({ playing: true }), state())).toBeNull();
    // Stop is no request of its own, so whatever else changed with it still is.
    expect(panelForChange(state({ playing: true }), state({ revealed: 'tex1' }))).toBe('project');
  });

  it('leaves the dock alone when nothing that matters changed', () => {
    // This runs on every store change — a selection, a filter, a mutation. A
    // decision made from the *state* rather than the change would yank the
    // Viewport back every time anything moved, and would do it once at startup
    // over whatever the author had left in front.
    expect(panelForChange(state(), state())).toBeNull();
    expect(panelForChange(state({ playing: true }), state({ playing: true }))).toBeNull();
  });

  it('stays on the game through a pause', () => {
    // `playing` is "anything but stopped", so pausing is not a change here and
    // the Viewport is not shown again.
    expect(panelForChange(state({ playing: true }), state({ playing: true }))).toBeNull();
  });

  it('shows the project panel for a new reveal, and only a new one', () => {
    expect(panelForChange(state(), state({ revealed: 'tex1' }))).toBe('project');
    expect(panelForChange(state({ revealed: 'tex1' }), state({ revealed: 'tex2' }))).toBe('project');
    // The panel clears `revealed` once it has drawn the highlight, and that is
    // not a request for anything.
    expect(panelForChange(state({ revealed: 'tex1' }), state())).toBeNull();
    expect(panelForChange(state({ revealed: 'tex1' }), state({ revealed: 'tex1' }))).toBeNull();
  });

  it('prefers the game when both change at once', () => {
    // Cannot happen today, and settling it costs nothing: what was asked for
    // last is the game.
    expect(panelForChange(state(), state({ playing: true, revealed: 'tex1' }))).toBe('viewport');
  });

  it('shows the Inspector for a new Scene Settings request, and only a new one', () => {
    expect(panelForChange(state(), state({ sceneSettings: 1 }))).toBe('inspector');
    expect(panelForChange(state({ sceneSettings: 1 }), state({ sceneSettings: 2 }))).toBe('inspector');
    expect(panelForChange(state({ sceneSettings: 2 }), state({ sceneSettings: 2 }))).toBeNull();
  });

  it('prefers the game over a Scene Settings request in the same change', () => {
    // Cannot happen either — they are two gestures — and it is settled the same
    // way.
    expect(panelForChange(state(), state({ playing: true, sceneSettings: 1 }))).toBe('viewport');
  });

  it('shows the Console for a new request, and only a new one', () => {
    // A failed Play's toast asks for it: the details of a compile error or of a
    // start that threw are there, and nowhere else.
    expect(panelForChange(state(), state({ console: 1 }))).toBe('console');
    expect(panelForChange(state({ console: 1 }), state({ console: 2 }))).toBe('console');
    expect(panelForChange(state({ console: 2 }), state({ console: 2 }))).toBeNull();
  });

  it('prefers the game over a Console request in the same change', () => {
    expect(panelForChange(state(), state({ playing: true, console: 1 }))).toBe('viewport');
  });
});

describe('what the stores ask for', () => {
  it('brings nothing forward when the selection empties, and the Inspector on a request', () => {
    // The selection is no input, on purpose. Scene Settings… empties it, and so
    // does every click into empty space: were "nothing selected" the request,
    // the Inspector would come forward on every deselect, over whatever tab the
    // author had in front. Through the watcher, since a field the decision does
    // not read cannot be handed to it.
    const stop = watchPanelFocus();
    try {
      useEditorStore.getState().setSelection(['crate']);
      useEditorStore.getState().clearSelection();
      expect(showPanel).not.toHaveBeenCalled();

      useEditorStore.getState().requestSceneSettings();
      expect(vi.mocked(showPanel).mock.calls).toEqual([['inspector']]);
    } finally {
      stop();
    }
  });

  it('brings the Console forward on a request', () => {
    vi.mocked(showPanel).mockClear();
    const stop = watchPanelFocus();
    try {
      useEditorStore.getState().requestConsole();
      expect(vi.mocked(showPanel).mock.calls).toEqual([['console']]);
    } finally {
      stop();
    }
  });
});
