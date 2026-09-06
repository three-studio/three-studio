import { describe, expect, it } from 'vitest';
import { panelForChange, type FocusInputs } from '../src/shell/panelFocus';

/*
 * Bringing a panel forward is a reaction to a change of state, and it used to be
 * `commands/` doing it by hand: `startPlay` called `showPanel('game')`, so the
 * command layer imported the shell and reached into the dock.
 *
 * Extracted from the subscription so it can be checked without a dock — the
 * decision is the part worth pinning, and the subscription around it is three
 * lines of plumbing.
 */

const state = (over: Partial<FocusInputs> = {}): FocusInputs => ({
  playing: false,
  revealed: null,
  ...over,
});

describe('what a change of state brings forward', () => {
  it('shows the game when it starts, and the scene when it stops', () => {
    expect(panelForChange(state(), state({ playing: true }))).toBe('game');
    expect(panelForChange(state({ playing: true }), state())).toBe('viewport');
  });

  it('leaves the dock alone when nothing that matters changed', () => {
    // This runs on every store change — a selection, a filter, a mutation. A
    // decision made from the *state* rather than the change would yank the Scene
    // tab back every time anything moved, and would do it once at startup over
    // whatever the author had left in front.
    expect(panelForChange(state(), state())).toBeNull();
    expect(panelForChange(state({ playing: true }), state({ playing: true }))).toBeNull();
  });

  it('stays on the game through a pause', () => {
    // `playing` is "anything but stopped", so pausing is not a change here and
    // the Game panel is not re-shown — nor is the Scene panel pulled forward.
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
    expect(panelForChange(state(), state({ playing: true, revealed: 'tex1' }))).toBe('game');
  });
});
