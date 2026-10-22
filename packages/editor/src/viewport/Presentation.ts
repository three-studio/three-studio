import { seenOnScreen } from './fullScreen';

/**
 * One view of what the single renderer drew: the edit view, the game, or the
 * import dialog's preview.
 *
 * **Why a copy rather than the renderer's own canvas.** A renderer has exactly
 * one canvas, and a second renderer is not the way out: two `WebGPURenderer`s
 * drawing inside one animation frame destroy and rebuild each other's output
 * target every frame — hundreds of `Destroyed texture … used in a submit` per
 * second, measured, which is the whole reason `rendererCount` exists. So the
 * renderer draws into one surface that is in no document, each view takes its
 * turn in a corner of it, and each view blits its own corner out here. That is
 * what gives the edit view and the game a canvas each — stacked on the
 * Viewport's stage, each with the input that listens on it — and what lets the
 * import dialog's model preview be a third view rather than the second renderer
 * it used to be.
 *
 * The corner is always the top-left, because that is where
 * `renderer.setViewport(0, 0, w, h)` lands in both backends: three's WebGPU
 * backend hands the viewport straight to WebGPU, whose origin is top-left, and
 * its WebGL fallback flips it (`WebGLBackend.updateViewport` renders at
 * `renderContext.height - height - y`) so that the two agree. A canvas 2D
 * source rectangle is measured from the top-left too, so the copy is (0, 0) to
 * (0, 0) either way.
 */
export class Presentation {
  /** The element on screen. Sized in device pixels, laid out by CSS. */
  readonly canvas = document.createElement('canvas');
  /** The element this view's canvas is in, or null while it is in none. */
  host: HTMLElement | null = null;
  /**
   * The host's box in CSS pixels, as of the last `measure`.
   *
   * Zero while nothing is showing this view. **Not zero for a panel on a hidden
   * tab**, which is what this comment used to claim: dockview parks an inactive
   * tab off-screen at the full window size rather than collapsing it, so the box
   * stays large and only its position says it is gone. See `onScreen`.
   */
  width = 0;
  height = 0;

  /**
   * Whether the host's panel is on a tab a person can see.
   *
   * The half `width`/`height` cannot answer, and the difference was measured:
   * dockview parks a tab behind another at full size, and a view parked that
   * way still reported 1512 × 849 — so the editor went on drawing it behind the
   * tab in front, 18 016 draw calls a frame instead of 9 006, and 20.1 ms
   * instead of 10.8.
   *
   * Pushed by the panel, through `ViewportRenderer.setOnScreen`, from the dock's
   * own `isVisible`: the dock is the only thing that knows. An observer on this
   * side was tried and could not tell, and that method says why.
   *
   * `true` until the panel says otherwise, so a view that has just been
   * attached draws its first frame instead of blinking.
   */
  onScreen = true;

  private readonly context: CanvasRenderingContext2D;

  constructor(view: 'edit' | 'game' | 'preview') {
    // `alpha: false` because what arrives is opaque — the scene clears to its
    // own background — and an opaque 2D canvas is the cheaper composite.
    const context = this.canvas.getContext('2d', { alpha: false });
    if (context === null) {
      throw new Error('This browser has no 2D canvas to show the viewport in.');
    }
    this.context = context;

    this.canvas.className = 'block h-full w-full outline-none';
    // Focusable, because this is the element a view's input works against: the
    // editor's pointer and keyboard on the edit view, the game's `Input` on the
    // game's, the preview's `OrbitControls` on its own. The first two used to
    // be the same element and had to take turns.
    this.canvas.tabIndex = 0;
    // Named because they are otherwise identical elements — two of them in one
    // panel — and the headless checks have to tell them apart.
    this.canvas.dataset['view'] = view;
  }

  /**
   * Whether anyone could be looking at this view.
   *
   * The dock answers while nothing holds the full screen; the screen answers
   * while something does. See `seenOnScreen`. Which of the Viewport's two
   * canvases is on top is not this side's to know: both have a box, and the
   * frame loop asks `viewState`.
   */
  get visible(): boolean {
    return (
      this.width > 0 &&
      this.height > 0 &&
      seenOnScreen(document.fullscreenElement, this.host, this.onScreen)
    );
  }

  /** Reads the host's box. True when it moved. */
  measure(): boolean {
    const width = this.host?.clientWidth ?? 0;
    const height = this.host?.clientHeight ?? 0;
    if (width === this.width && height === this.height) return false;

    this.width = width;
    this.height = height;
    return true;
  }

  /**
   * Copies this view's corner of the surface out.
   *
   * `floor(css × ratio)` is three's own arithmetic — `CanvasTarget.setSize`
   * writes the drawing buffer that way and the viewport is floored the same way
   * — so the rectangle asked for here is exactly the rectangle that was drawn.
   */
  show(surface: HTMLCanvasElement, pixelRatio: number): void {
    const width = Math.floor(this.width * pixelRatio);
    const height = Math.floor(this.height * pixelRatio);
    if (width === 0 || height === 0) return;

    // Assigning either dimension clears the canvas, so it happens only when the
    // size actually moved — otherwise every frame would start from blank.
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    this.context.drawImage(surface, 0, 0, width, height, 0, 0, width, height);
  }

  /**
   * Empties the canvas: its bitmap goes to nothing, and `show` sizes it again
   * at the next frame drawn.
   *
   * The game's, at Stop. Emptied rather than painted black, so that nothing of
   * a session outlives it — neither its last frame, which the next Play used to
   * show while it started, nor a bitmap the size of the screen kept for a view
   * nobody is looking at.
   */
  clear(): void {
    this.canvas.width = 0;
    this.canvas.height = 0;
  }
}
