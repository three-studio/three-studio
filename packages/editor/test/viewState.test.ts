import { describe, expect, it } from 'vitest';
import type { PlayState } from '../src/state/editorStore';
import { captureHintText, gameTakesFocus, viewState } from '../src/viewport/viewState';

/*
 * What the Viewport shows. One panel holds the edit view and the game, their two
 * canvases stacked on its stage, and the panel and the frame loop both have to
 * agree on which one is on top: a loop that draws the canvas the panel hides
 * costs a whole render a frame for nothing, and one that skips the canvas the
 * panel shows leaves a frozen picture on screen — which is exactly what the
 * start wants, and nothing else does.
 */

/** What the game holds in the cases about what is shown: neither the keys nor the mouse. */
const HOLDS_NOTHING = { gameHasKeys: false, gameHasMouse: false } as const;

describe('what the view shows', () => {
  it('shows the edit view while stopped, with what editing lays over it', () => {
    expect(viewState({ playState: 'stopped', gameShown: false, ...HOLDS_NOTHING })).toEqual({
      mode: 'edit',
      canvas: 'edit',
      drawn: 'edit',
      input: 'editor',
      header: 'edit',
      gameHolds: 'nothing',
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
    expect(viewState({ playState: 'playing', gameShown: false, ...HOLDS_NOTHING })).toEqual({
      mode: 'starting',
      canvas: 'edit',
      drawn: 'game',
      input: 'none',
      header: 'play',
      gameHolds: 'nothing',
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
    expect(viewState({ playState: 'playing', gameShown: true, ...HOLDS_NOTHING })).toEqual({
      mode: 'playing',
      canvas: 'game',
      drawn: 'game',
      input: 'game',
      header: 'play',
      gameHolds: 'nothing',
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
    expect(viewState({ playState: 'paused', gameShown: true, ...HOLDS_NOTHING })).toEqual({
      mode: 'paused',
      canvas: 'game',
      drawn: 'game',
      input: 'game',
      header: 'play',
      gameHolds: 'nothing',
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
    expect(viewState({ playState: 'playing', gameShown: false, ...HOLDS_NOTHING }).mode).toBe('starting');
    expect(viewState({ playState: 'paused', gameShown: false, ...HOLDS_NOTHING })).toEqual(
      viewState({ playState: 'playing', gameShown: false, ...HOLDS_NOTHING }),
    );
  });

  it('is the edit view while stopped, whatever the last session drew', () => {
    expect(viewState({ playState: 'stopped', gameShown: true, ...HOLDS_NOTHING })).toEqual(
      viewState({ playState: 'stopped', gameShown: false, ...HOLDS_NOTHING }),
    );
  });

  it('draws a canvas other than the one on top only while starting', () => {
    const cases = (['stopped', 'playing', 'paused'] as PlayState[]).flatMap((playState) =>
      [false, true].map((gameShown) => viewState({ playState, gameShown, ...HOLDS_NOTHING })),
    );
    expect(cases.filter((view) => view.drawn !== view.canvas).map((view) => view.mode)).toEqual([
      'starting',
      'starting',
    ]);
  });

  it('lays nothing over the starting stage but its pill', () => {
    const { overlays } = viewState({ playState: 'playing', gameShown: false, ...HOLDS_NOTHING });
    expect(Object.entries(overlays).filter(([, on]) => on).map(([name]) => name)).toEqual(['starting']);
  });

  it('gives the editor the view’s pointer only while stopped, and the game only once it shows', () => {
    // From the press of Play the view is not the editor's: a press on it must
    // neither fly the editor camera nor drag a handle into an edit the scene
    // lock refuses. While starting, it is nobody's: the edit image is a
    // picture.
    expect(viewState({ playState: 'stopped', gameShown: false, ...HOLDS_NOTHING }).input).toBe('editor');
    expect(viewState({ playState: 'playing', gameShown: false, ...HOLDS_NOTHING }).input).toBe('none');
    expect(viewState({ playState: 'playing', gameShown: true, ...HOLDS_NOTHING }).input).toBe('game');
    expect(viewState({ playState: 'paused', gameShown: true, ...HOLDS_NOTHING }).input).toBe('game');
  });

  it('heads the view with the edit tools while stopped, and with the play bar from the press', () => {
    // From the press rather than from the first frame: while the game starts
    // the edit image is a picture, and its tools would be buttons over it.
    const header = (playState: PlayState, gameShown: boolean) =>
      viewState({ playState, gameShown, ...HOLDS_NOTHING }).header;
    expect(header('stopped', false)).toBe('edit');
    expect(header('stopped', true)).toBe('edit');
    // Starting, from Play and from a Pause pressed before the first frame.
    expect(header('playing', false)).toBe('play');
    expect(header('paused', false)).toBe('play');
    expect(header('playing', true)).toBe('play');
    expect(header('paused', true)).toBe('play');
  });

  it('says how the editor camera flies, and how the edit view is lit, only while the scene is edited', () => {
    // The fly speed is the editor camera's, and "Lighting: Editor default" is a
    // light Play and a build do not have: over the game, or over the edit image
    // held while it starts, both describe something not on screen.
    const cases = (['stopped', 'playing', 'paused'] as PlayState[]).flatMap((playState) =>
      [false, true].map((gameShown) => viewState({ playState, gameShown, ...HOLDS_NOTHING })),
    );
    expect(cases.filter((view) => view.overlays.editStats).map((view) => view.mode)).toEqual(['edit', 'edit']);
  });
});

describe('whether Play gives the game the keyboard as its canvas comes on top', () => {
  /*
   * The game hears keys only while its canvas holds the focus, and the canvas
   * can take it only once it shows, at the game's first frame — seconds after
   * the press. Taking it then from wherever the person has since put it would
   * throw away what they were typing.
   */
  const body = { is: 'the body' };
  const play = { is: 'the Play button' };
  const field = { is: 'the Console’s filter' };

  it('takes it when the focus is nowhere, or still where Play left it', () => {
    expect(gameTakesFocus(play, null, body)).toBe(true);
    // Where `inert` sends a focus the edit canvas held at the press, and where a
    // press on bare panel space leaves it.
    expect(gameTakesFocus(play, body, body)).toBe(true);
    expect(gameTakesFocus(play, play, body)).toBe(true);
    expect(gameTakesFocus(null, null, body)).toBe(true);
  });

  it('leaves it where the person has put it since the press', () => {
    expect(gameTakesFocus(play, field, body)).toBe(false);
    expect(gameTakesFocus(null, field, body)).toBe(false);
    expect(gameTakesFocus(body, field, body)).toBe(false);
  });
});

describe('what the game holds, which the capture hint speaks to', () => {
  const holds = (playState: PlayState, gameHasKeys: boolean, gameHasMouse: boolean) =>
    viewState({ playState, gameShown: true, gameHasKeys, gameHasMouse }).gameHolds;

  it('is the mouse while the pointer is locked to the game, else the keys while it has the focus, else nothing', () => {
    for (const playState of ['playing', 'paused'] as const) {
      expect(holds(playState, false, false), playState).toBe('nothing');
      expect(holds(playState, true, false), playState).toBe('keys');
      expect(holds(playState, true, true), playState).toBe('mouse');
      // A focus that left while the lock held: Esc frees the mouse either way.
      expect(holds(playState, false, true), playState).toBe('mouse');
    }
  });
});

describe('the capture hint’s words', () => {
  const panel = { fullScreen: false, stopKey: '⇧Esc' };
  const fullScreen = { fullScreen: true, stopKey: '⇧Esc' };

  it('say what a click will do, and how to stop', () => {
    expect(captureHintText('nothing', panel)).toBe('Click to play · ⇧Esc to stop');
    expect(captureHintText('nothing', fullScreen)).toBe('Click to play · ⇧Esc to stop');
    expect(captureHintText('keys', panel)).toBe('Click to capture the mouse · ⇧Esc to stop');
    expect(captureHintText('keys', fullScreen)).toBe('Click to capture the mouse · ⇧Esc to stop');
  });

  it('say Esc with the mouse captured in the panel, and ⇧Esc full screen', () => {
    // In the panel the browser takes every Escape, Shift or not, to free a
    // captured mouse before the page hears it: ⇧Esc would free the mouse and
    // the game would go on. Full screen, the keyboard lock hands Escape to the
    // page, and ⇧Esc stops.
    expect(captureHintText('mouse', panel)).toBe('Esc to release the mouse');
    expect(captureHintText('mouse', fullScreen)).toBe('⇧Esc to stop');
  });

  it('drop the stop while Stop has no key, and say nothing where that was all', () => {
    const unbound = { fullScreen: false, stopKey: undefined };
    expect(captureHintText('nothing', unbound)).toBe('Click to play');
    expect(captureHintText('keys', unbound)).toBe('Click to capture the mouse');
    expect(captureHintText('mouse', unbound)).toBe('Esc to release the mouse');
    expect(captureHintText('mouse', { fullScreen: true, stopKey: undefined })).toBe('');
  });
});
