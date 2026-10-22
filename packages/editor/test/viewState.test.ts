import { describe, expect, it } from 'vitest';
import type { PlayState } from '../src/state/editorStore';
import { viewState } from '../src/viewport/viewState';

/*
 * What the Viewport shows. One panel holds the edit view and the game, their two
 * canvases stacked on its stage, and the panel and the frame loop both have to
 * agree on which one is on top: a loop that draws the canvas the panel hides
 * costs a whole render a frame for nothing, and one that skips the canvas the
 * panel shows leaves a frozen picture on screen.
 */

describe('what the view shows', () => {
  it('shows the edit view while stopped, with what editing lays over it', () => {
    expect(viewState({ playState: 'stopped' })).toEqual({
      mode: 'edit',
      canvas: 'edit',
      overlays: { prefabBar: true, dropTarget: true, paused: false, problems: false, captureHint: false },
    });
  });

  it('shows the game while it plays, with its problems and the capture hint', () => {
    expect(viewState({ playState: 'playing' })).toEqual({
      mode: 'playing',
      canvas: 'game',
      overlays: { prefabBar: false, dropTarget: false, paused: false, problems: true, captureHint: true },
    });
  });

  it('keeps the game while it is paused, and says it is', () => {
    expect(viewState({ playState: 'paused' })).toEqual({
      mode: 'paused',
      canvas: 'game',
      overlays: { prefabBar: false, dropTarget: false, paused: true, problems: true, captureHint: true },
    });
  });

  it('puts the edit canvas on top only while stopped', () => {
    const states: PlayState[] = ['stopped', 'playing', 'paused'];
    expect(states.filter((playState) => viewState({ playState }).canvas === 'edit')).toEqual(['stopped']);
  });
});
