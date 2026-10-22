import { describe, expect, it } from 'vitest';
import type { PlayState } from '../src/state/editorStore';
import { viewState } from '../src/viewport/viewState';

/*
 * What the Viewport shows. One panel holds the edit view and the game, their two
 * canvases stacked on its stage, and the panel and the frame loop both have to
 * agree on which one is on top: a loop that draws the canvas the panel hides
 * costs a whole render a frame for nothing, and one that skips the canvas the
 * panel shows leaves a frozen picture on screen — which is exactly what the
 * start wants, and nothing else does.
 */

describe('what the view shows', () => {
  it('shows the edit view while stopped, with what editing lays over it', () => {
    expect(viewState({ playState: 'stopped', gameShown: false })).toEqual({
      mode: 'edit',
      canvas: 'edit',
      drawn: 'edit',
      input: 'editor',
      overlays: {
        prefabBar: true,
        dropTarget: true,
        paused: false,
        problems: false,
        captureHint: false,
        starting: false,
        editStats: true,
      },
    });
  });

  it('holds the edit image while the game starts, and draws the game underneath', () => {
    // From the press until the game's first frame: the edit image stays on top,
    // undrawn and inert, under its pill, while the game draws into its own
    // canvas unseen. Neither a frame of the last session nor a blank one can
    // show.
    expect(viewState({ playState: 'playing', gameShown: false })).toEqual({
      mode: 'starting',
      canvas: 'edit',
      drawn: 'game',
      input: 'none',
      overlays: {
        prefabBar: false,
        dropTarget: false,
        paused: false,
        problems: false,
        captureHint: false,
        starting: true,
        editStats: false,
      },
    });
  });

  it('shows the game once it has drawn, with its problems and the capture hint', () => {
    expect(viewState({ playState: 'playing', gameShown: true })).toEqual({
      mode: 'playing',
      canvas: 'game',
      drawn: 'game',
      input: 'game',
      overlays: {
        prefabBar: false,
        dropTarget: false,
        paused: false,
        problems: true,
        captureHint: true,
        starting: false,
        editStats: false,
      },
    });
  });

  it('keeps the game while it is paused, and says it is', () => {
    expect(viewState({ playState: 'paused', gameShown: true })).toEqual({
      mode: 'paused',
      canvas: 'game',
      drawn: 'game',
      input: 'game',
      overlays: {
        prefabBar: false,
        dropTarget: false,
        paused: true,
        problems: true,
        captureHint: true,
        starting: false,
        editStats: false,
      },
    });
  });

  it('is starting until the first frame, paused or not', () => {
    // Paused before the first frame shows the pill alone: no Paused badge over
    // an edit image, and the transport already shows the pause.
    expect(viewState({ playState: 'playing', gameShown: false }).mode).toBe('starting');
    expect(viewState({ playState: 'paused', gameShown: false })).toEqual(
      viewState({ playState: 'playing', gameShown: false }),
    );
  });

  it('is the edit view while stopped, whatever the last session drew', () => {
    expect(viewState({ playState: 'stopped', gameShown: true })).toEqual(
      viewState({ playState: 'stopped', gameShown: false }),
    );
  });

  it('draws a canvas other than the one on top only while starting', () => {
    const cases = (['stopped', 'playing', 'paused'] as PlayState[]).flatMap((playState) =>
      [false, true].map((gameShown) => viewState({ playState, gameShown })),
    );
    expect(cases.filter((view) => view.drawn !== view.canvas).map((view) => view.mode)).toEqual([
      'starting',
      'starting',
    ]);
  });

  it('lays nothing over the starting stage but its pill', () => {
    const { overlays } = viewState({ playState: 'playing', gameShown: false });
    expect(Object.entries(overlays).filter(([, on]) => on).map(([name]) => name)).toEqual(['starting']);
  });

  it('gives the editor the view’s pointer only while stopped, and the game only once it shows', () => {
    // From the press of Play the view is not the editor's: a press on it must
    // neither fly the editor camera nor drag a handle into an edit the scene
    // lock refuses. While starting, it is nobody's: the edit image is a
    // picture.
    expect(viewState({ playState: 'stopped', gameShown: false }).input).toBe('editor');
    expect(viewState({ playState: 'playing', gameShown: false }).input).toBe('none');
    expect(viewState({ playState: 'playing', gameShown: true }).input).toBe('game');
    expect(viewState({ playState: 'paused', gameShown: true }).input).toBe('game');
  });

  it('says how the editor camera flies, and how the edit view is lit, only while the scene is edited', () => {
    // The fly speed is the editor camera's, and "Lighting: Editor default" is a
    // light Play and a build do not have: over the game, or over the edit image
    // held while it starts, both describe something not on screen.
    const cases = (['stopped', 'playing', 'paused'] as PlayState[]).flatMap((playState) =>
      [false, true].map((gameShown) => viewState({ playState, gameShown })),
    );
    expect(cases.filter((view) => view.overlays.editStats).map((view) => view.mode)).toEqual(['edit', 'edit']);
  });
});
