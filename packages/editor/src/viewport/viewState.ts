import type { PlayState } from '../state/editorStore';

/*
 * What the Viewport shows, decided in one place.
 *
 * The Viewport is where the scene is edited and where the game is played. Its
 * stage holds two canvases, stacked — the edit view's and the game's — and two
 * readers have to agree on which one is in front: the panel, which puts that
 * one on top and lays its overlays over it, and the frame loop, which draws it.
 * Were each to decide for itself, a drift between them would either draw a
 * whole frame nobody can see, or leave a canvas on screen that nothing draws
 * any more, frozen on its last picture.
 *
 * Pure — no DOM, no store — so that the rule is tested in node, and the panel
 * and the loop only read it.
 */

/** What the decision is made from. */
export interface ViewInputs {
  /** `editorStore.playState`. */
  playState: PlayState;
}

export type ViewMode = 'edit' | 'playing' | 'paused';

export interface ViewState {
  mode: ViewMode;
  /**
   * The canvas on top of the stage: the one a person sees, and the only one
   * drawn — a view nobody sees is not drawn, which is what keeps Play at one
   * render a frame.
   */
  canvas: 'edit' | 'game';
  /** What is laid over the stage. */
  overlays: {
    /** Prefab Mode's bar: it is about what is being edited. */
    prefabBar: boolean;
    /**
     * Whether an asset can be dropped on the view. A drop places into the edit
     * view's scene, at a point measured on the edit canvas, which is hidden
     * while the game runs.
     */
    dropTarget: boolean;
    /** The badge that says the game is paused. */
    paused: boolean;
    /**
     * Where the running scene's problems may show. The box itself appears only
     * while there are some.
     */
    problems: boolean;
    /** How to give the game the mouse, and how to stop it. */
    captureHint: boolean;
  };
}

export function viewState(inputs: ViewInputs): ViewState {
  if (inputs.playState === 'stopped') {
    return {
      mode: 'edit',
      canvas: 'edit',
      overlays: { prefabBar: true, dropTarget: true, paused: false, problems: false, captureHint: false },
    };
  }
  // Paused is still the game: the picture stays, and a badge says why it does
  // not move.
  const paused = inputs.playState === 'paused';
  return {
    mode: paused ? 'paused' : 'playing',
    canvas: 'game',
    overlays: { prefabBar: false, dropTarget: false, paused, problems: true, captureHint: true },
  };
}
