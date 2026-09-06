import type { RenderingSettings } from '@three-studio/core';
import { createRenderer, type RendererBackend } from '@three-studio/runtime';
import type { Camera, Scene, WebGPURenderer } from 'three/webgpu';
import { useViewportStore } from '../state/viewportStore';
import { retireFrameBufferTarget } from './frameBufferTarget';
import { Presentation } from './Presentation';
import { installRenderProbe, probeFrame, probeResize } from './renderProbe';

const STATS_INTERVAL_MS = 500;

/**
 * One renderer, one off-screen canvas, three panels showing corners of it.
 *
 * Lifted out of `EditorViewport`, which was 1170 lines and seven jobs. This is
 * the one that owns a device: the `WebGPURenderer`, the surface it draws into,
 * the three `Presentation`s that copy out of it, the size they agree on, and
 * the frame counter.
 *
 * **One renderer for the document, and that is not a preference.** Two
 * `WebGPURenderer`s drawing inside one animation frame destroy and rebuild each
 * other's output target every frame; the import dialog's model preview used to
 * be a second one, and the viewport froze for as long as the dialog was open.
 * A third `Presentation` is the answer — see `attachPreview` on the viewport.
 *
 * What it deliberately does **not** own is any camera. `resize` measures the
 * boxes and sizes the surface; whose aspect that changes is a question for the
 * editor camera, the running engine and the preview, and each of them answers
 * it where it lives.
 */
export class ViewportRenderer {
  readonly renderer: WebGPURenderer;
  readonly backend: RendererBackend;

  /**
   * Where the renderer draws, and it is in no document.
   *
   * Everything on screen is a copy taken out of a corner of this. It is as big
   * as the largest panel showing a view, never bigger: resizing it retires
   * three's tone-mapping target, which is what `retireFrameBufferTarget` is
   * about, so it is a thing to do when a panel moves and not per frame.
   */
  private readonly surface: HTMLCanvasElement;

  /**
   * The Scene view's panel, and what the editor's pointer and keyboard work
   * against — the canvas of the panel the handles are actually drawn in.
   */
  readonly sceneView = new Presentation('scene');
  /** The running game's panel. The engine's `Input` listens on its canvas. */
  readonly gameView = new Presentation('game');
  /**
   * The third view: a scene of somebody else's, drawn through this renderer.
   *
   * Today that is the import dialog's model preview, and it is the whole of
   * `attachPreview`'s reason to exist — see there.
   */
  readonly previewView = new Presentation('preview');

  private readonly resizeObserver: ResizeObserver;
  /** Last size handed to `setSize`, so an unchanged one can be skipped. */
  private lastWidth = 0;
  private lastHeight = 0;
  /**
   * Set when the container's box changed, cleared when the frame loop acts on it.
   *
   * The observer only raises the flag. Resizing a WebGPU renderer retires its
   * output target and its swap chain, and doing that from an observer callback
   * puts it at a point in the turn this side does not choose — after the frame's
   * passes, interleaved with whatever else observed the same layout. The frame
   * loop is the one place where nothing is half-encoded.
   */
  private sizeDirty = false;
  private framesSinceReport = 0;
  private lastReportTime = 0;
  private disposed = false;

  static async create(rendering: RenderingSettings): Promise<ViewportRenderer> {
    // The renderer's own canvas, which no panel ever holds and which therefore
    // needs neither a class nor a tab index: what is on screen is a copy of a
    // corner of it, taken by `Presentation`.
    const surface = document.createElement('canvas');
    const { renderer, backend } = await createRenderer({
      canvas: surface,
      forceWebGL: rendering.forceWebGL,
      antialias: rendering.antialias,
      maxPixelRatio: rendering.maxPixelRatio,
      shadows: rendering.shadows,
      exposure: rendering.exposure,
    });
    // Off unless `studio.probe.render` is set in localStorage; see `renderProbe`.
    installRenderProbe(renderer);
    return new ViewportRenderer(surface, renderer, backend);
  }

  private constructor(
    surface: HTMLCanvasElement,
    renderer: WebGPURenderer,
    backend: RendererBackend,
  ) {
    this.surface = surface;
    this.renderer = renderer;
    this.backend = backend;
    this.resizeObserver = new ResizeObserver(() => (this.sizeDirty = true));
  }

  /**
   * The box changed and the surface has not been told yet.
   *
   * A flag rather than an action, and the frame loop is what acts on it.
   * Resizing a WebGPU renderer retires its output target and its swap chain,
   * and doing that from an observer callback puts it at a point in the turn
   * this side does not choose. `beginPlay` raises it too, so that the engine
   * that has just appeared is handed the shape of its panel.
   */
  markResized(): void {
    this.sizeDirty = true;
  }

  get resizePending(): boolean {
    return this.sizeDirty;
  }

  /** First thing in a frame, so a destroy reported later can be attributed. */
  probe(): void {
    probeFrame(this.renderer, this.sceneView.host);
  }

  /**
   * Takes every view's box, and sizes the one surface to hold the largest.
   *
   * @returns Whether the Scene view's own box moved, which is the one thing the
   *   caller cannot measure for itself and the one camera aspect that is only
   *   worth recomputing when it did.
   *
   * Each view is drawn into the top-left corner of the surface at its own size,
   * so the surface has to be as large as the largest of them and there is no
   * reason for it to be larger. Sizing it per view instead — a `setSize` before
   * each render — would retire three's tone-mapping target twice a frame, which
   * is the churn `retireFrameBufferTarget` exists to keep down to one per
   * resize.
   */
  applyResize(): boolean {
    this.sizeDirty = false;
    const sceneMoved = this.sceneView.measure();
    // Measured for the side effect, and the answer is not needed by anyone: the
    // game's and the preview's aspects are pushed by the viewport whether or
    // not their panel is the thing that moved.
    this.gameView.measure();
    this.previewView.measure();

    const width = Math.max(this.sceneView.width, this.gameView.width, this.previewView.width);
    const height = Math.max(this.sceneView.height, this.gameView.height, this.previewView.height);

    // Measured, not acted on. Whether a same-size `setSize` is worth skipping is
    // the question the probe is here to answer, and skipping it now would change
    // the behaviour being measured. See `renderProbe`.
    // Nothing moved. `setSize` has no early-out of its own — `CanvasTarget`
    // rewrites `domElement.width`/`height` unconditionally, which reconfigures
    // the WebGPU swap chain even for an identical value — so the one that counts
    // has to live here.
    const changed = width !== this.lastWidth || height !== this.lastHeight;
    probeResize(width, height, changed);
    if (!changed) return sceneMoved;
    // Nothing is showing a view: a dock panel on a hidden tab reports zero, and
    // resizing to that would destroy the swap chain and hand back a black
    // canvas when the tab comes forward again. The surface keeps its size.
    if (width === 0 || height === 0) return sceneMoved;

    this.lastWidth = width;
    this.lastHeight = height;
    this.renderer.setSize(width, height, false);
    retireFrameBufferTarget(this.renderer);
    return sceneMoved;
  }

  /**
   * Renders one view into its corner of the surface, and hands its panel a copy.
   *
   * A panel nobody is looking at — a closed tab, or one behind another — has a
   * zero-sized box and is not drawn at all. That is the same answer a hidden
   * dock panel gave before by being the panel the canvas was not in, arrived at
   * by measuring rather than by which panel happened to hold the canvas.
   *
   * **This is where a post-processing pipeline enters on this side**, and it
   * enters *per view*: a `RenderPipeline` is made from `pass(scene, camera)`, so
   * the three views want three of them rather than one belonging to the
   * renderer. Nothing above has to move for that — the renderer and the loop are
   * already this class's, which is the whole of the seam; see the class comment
   * on `Engine`.
   *
   * What is not free is the size, and it is worth knowing before starting.
   * `PassNode` sizes its render target from `renderer.getDrawingBufferSize()`
   * (`PassNode.js:801`), and a render *into* a target takes that target's own
   * viewport instead of the one `setViewport` just wrote (`Renderer.js:1619`).
   * So a pass here would draw the scene at the size of the whole surface — the
   * largest visible panel — and the composite quad would then be squeezed into
   * this view's corner. A host showing one full-canvas view never meets it,
   * which is why the launcher's pipeline and an exported build's would both be
   * straightforward. Whoever writes this one decides what size the pass runs at;
   * the seam does not decide it for them.
   */
  draw(scene: Scene, camera: Camera, view: Presentation): void {
    if (!view.visible) return;

    // The surface is at least this big — `resize` sized it to the largest
    // visible panel — so the view fits in its corner. `setSize` resets this,
    // which is why it is set per draw rather than per resize.
    this.renderer.setViewport(0, 0, view.width, view.height);
    /*
     * `render()` and **not** `renderAsync()`. The two look interchangeable — the
     * async one is `await this.init(); this.render(...)` and nothing else — but
     * the await defers the render past the end of the animation frame callback,
     * and a WebGPU render that submits outside the frame it was started in
     * submits against textures that frame has already invalidated. It cost
     * hundreds of `Destroyed texture … used in a submit` per second back when
     * the import preview had a renderer of its own to make the mistake on; it
     * would cost the same here, on the only renderer there is.
     *
     * `render()` has one precondition, an initialised backend, and
     * `createRenderer` already awaits `renderer.init()`.
     */
    this.renderer.render(scene, camera);
    view.show(this.surface, this.renderer.getPixelRatio());
  }

  /** @param flySpeed The camera's, which is not this class's to read. */
  reportStats(time: number, flySpeed: number): void {
    this.framesSinceReport += 1;
    if (this.lastReportTime === 0) this.lastReportTime = time;

    const elapsed = time - this.lastReportTime;
    if (elapsed < STATS_INTERVAL_MS) return;

    // Everything the frame drew, both views included: three resets `info` once
    // per animation frame, not per render. That is the honest number for a frame
    // that drew the Scene and the Game, and it is unchanged for the frames that
    // drew only one.
    const { render } = this.renderer.info;
    useViewportStore.getState().setStats({
      fps: Math.round((this.framesSinceReport * 1000) / elapsed),
      drawCalls: render.drawCalls,
      triangles: render.triangles,
    });
    useViewportStore.getState().setFlySpeed(flySpeed);

    this.framesSinceReport = 0;
    this.lastReportTime = time;
  }

  dispose(): void {
    this.disposed = true;
    void this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.detach(this.sceneView);
    this.detach(this.gameView);
    this.detach(this.previewView);
    this.renderer.dispose();
  }

  /**
   * Moves one view's canvas into a dock panel.
   *
   * Two of these rather than one shared canvas handed back and forth, which is
   * what the Scene and Game panels used to do: whichever unmounted last took
   * the canvas away from the one that had just claimed it, so they each had to
   * know about play state to keep out of each other's way. A panel now owns its
   * own element and says nothing about the other.
   */
  attach(view: Presentation, host: HTMLElement): void {
    if (this.disposed || view.host === host) return;
    this.detach(view);
    view.host = host;
    host.appendChild(view.canvas);
    this.resizeObserver.observe(host);
    this.sizeDirty = true;
  }

  detach(view: Presentation): void {
    const host = view.host;
    if (!host) return;
    this.resizeObserver.unobserve(host);
    view.canvas.remove();
    view.host = null;
    // The surface is as large as the largest visible panel, so one going away
    // is a size change like any other.
    this.sizeDirty = true;
  }
}
