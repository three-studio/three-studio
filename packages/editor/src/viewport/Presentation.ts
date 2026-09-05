/**
 * One dock panel's view of what the single renderer drew.
 *
 * **Why a copy rather than the renderer's own canvas.** A renderer has exactly
 * one canvas, and a second renderer is not the way out: two `WebGPURenderer`s
 * drawing inside one animation frame destroy and rebuild each other's output
 * target every frame — hundreds of `Destroyed texture … used in a submit` per
 * second, measured, which is the whole reason `rendererCount` exists. So the
 * renderer draws into one surface that is in no document, each view takes its
 * turn in a corner of it, and each panel blits its own corner out here. That is
 * what lets the Scene and the Game be on screen at once, which one canvas moved
 * between them could never do.
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
  /** The element in the dock. Sized in device pixels, laid out by CSS. */
  readonly canvas = document.createElement('canvas');
  /** The dock panel showing this view, or null while none is. */
  host: HTMLElement | null = null;
  /**
   * The host's box in CSS pixels, as of the last `measure`.
   *
   * Zero while nothing is showing this view — a dock panel on a hidden tab
   * reports zero too, which is the same answer for the same reason: there is
   * nobody to draw this view for.
   */
  width = 0;
  height = 0;

  private readonly context: CanvasRenderingContext2D;

  constructor(view: 'scene' | 'game') {
    // `alpha: false` because what arrives is opaque — the scene clears to its
    // own background — and an opaque 2D canvas is the cheaper composite.
    const context = this.canvas.getContext('2d', { alpha: false });
    if (context === null) {
      throw new Error('This browser has no 2D canvas to show the viewport in.');
    }
    this.context = context;

    this.canvas.className = 'block h-full w-full outline-none';
    // Focusable, because this is the element the panel's input works against:
    // the editor's pointer and keyboard on the Scene view, the game's `Input`
    // on the Game view. They used to be the same element and had to take turns.
    this.canvas.tabIndex = 0;
    // Named because the two are otherwise identical elements in different
    // panels, and the headless check has to tell them apart.
    this.canvas.dataset['view'] = view;
  }

  /** Whether anyone is looking at this view. */
  get visible(): boolean {
    return this.width > 0 && this.height > 0;
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
}
