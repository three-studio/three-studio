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
  /** The running game has drawn a frame: `viewportStore.gameShown`. */
  gameShown: boolean;
}

export type ViewMode = 'edit' | 'starting' | 'playing' | 'paused';

export interface ViewState {
  mode: ViewMode;
  /** The canvas on top of the stage: the one a person sees. */
  canvas: 'edit' | 'game';
  /**
   * The canvas the frame loop draws. The one on top — a view nobody sees is not
   * drawn, which is what keeps Play at one render a frame — except while the
   * game starts: the edit image is held on top, undrawn, while the game's first
   * frame is drawn underneath, unseen.
   *
   * A field of its own rather than a rule in the loop, because that difference
   * is the whole of the start: the game's canvas comes on top with a frame of
   * this session in it, so neither the last frame of the session before — of
   * another scene, as like as not — nor a blank one can show. "The game" means
   * the game once there is one: until the engine exists nothing is drawn, which
   * is the loop's fact, since it has nothing to draw.
   */
  drawn: 'edit' | 'game';
  /**
   * Who hears the view's pointer: the editor's arbitration — the camera, the
   * handles, the selection — the game's `Input`, or nobody.
   *
   * The editor's only while stopped, and it leaves at the press of Play rather
   * than when the game arrives: while the game starts, the edit image on top is
   * a picture, and flying the camera or dragging a handle there would edit a
   * document Stop puts back. The game's `Input` hears it exactly while its
   * canvas is on top, since a hidden element takes no pointer.
   */
  input: 'editor' | 'game' | 'none';
  /** What is laid over the stage. */
  overlays: {
    /** Prefab Mode's bar: it is about what is being edited. */
    prefabBar: boolean;
    /**
     * Whether an asset can be dropped on the view. A drop places into the edit
     * view's scene, at a point measured on the edit canvas, which is not the
     * editor's from the press of Play.
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
    /** The pill that says the game is starting, over the edit image it holds. */
    starting: boolean;
    /**
     * The stats lines about the edit view: Fly, and Lighting while its
     * fallback is on. The fly speed is the editor camera's, and "Lighting:
     * Editor default" is a light Play and a build do not have — over the game,
     * both described something not on screen. The counters above them follow
     * whatever is drawn.
     */
    editStats: boolean;
  };
}

export function viewState(inputs: ViewInputs): ViewState {
  if (inputs.playState === 'stopped') {
    return {
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
    };
  }
  // Until the game's first frame, paused or not: a Paused badge over an edit
  // image would describe a picture that is not the game, and the transport
  // already shows the pause.
  if (!inputs.gameShown) {
    return {
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
    };
  }
  // Paused is still the game: the picture stays, and a badge says why it does
  // not move.
  const paused = inputs.playState === 'paused';
  return {
    mode: paused ? 'paused' : 'playing',
    canvas: 'game',
    drawn: 'game',
    input: 'game',
    overlays: {
      prefabBar: false,
      dropTarget: false,
      paused,
      problems: true,
      captureHint: true,
      starting: false,
      editStats: false,
    },
  };
}
