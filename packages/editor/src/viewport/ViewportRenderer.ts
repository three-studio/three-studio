import type { RenderingSettings } from '@three-studio/core';
import { RenderHost, createRenderer, resizeRenderer, type RendererBackend } from '@three-studio/runtime';
import type { Camera, Scene, WebGPURenderer } from 'three/webgpu';
import { useViewportStore } from '../state/viewportStore';
import { Presentation } from './Presentation';
import { installRenderProbe, probeFrame, probeResize } from './renderProbe';

const STATS_INTERVAL_MS = 500;

/**
 * One renderer, one off-screen canvas, three canvases showing corners of it.
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
 * editor camera, the running world and the preview, and each of them answers
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
   * The edit view, and what the editor's pointer and keyboard work against —
   * the canvas the handles are actually drawn in.
   */
  readonly editView = new Presentation('edit');
  /**
   * The running game's canvas, stacked with the edit view's on the Viewport's
   * stage. The world's `Input` listens on it.
   */
  readonly gameView = new Presentation('game');
  /**
   * The third view: a scene of somebody else's, drawn through this renderer.
   *
   * Today that is the import dialog's model preview, and it is the whole of
   * `attachPreview`'s reason to exist — see there.
   */
  readonly previewView = new Presentation('preview');

  /** Each view's host, on the one renderer. The game's carries what the editor lays over a running game. */
  readonly editHost: RenderHost;
  readonly gameHost: RenderHost;
  private readonly previewHost: RenderHost;

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
    this.editHost = new RenderHost({ renderer });
    this.gameHost = new RenderHost({ renderer });
    this.previewHost = new RenderHost({ renderer });
    this.resizeObserver = new ResizeObserver(() => (this.sizeDirty = true));
  }

  /**
   * Records whether a panel is somewhere a person could see it.
   *
   * Pushed in by the panel rather than observed from here, because **nothing on
   * this side can work it out**. The box does not say it — dockview parks an
   * inactive tab at full size — and an `IntersectionObserver` does not either:
   * it measures intersection with the viewport, and a tab hidden *behind*
   * another still intersects. Tried, measured, and it changed nothing.
   *
   * The dock is the only thing that knows, and it already publishes it as
   * `panel.api.isVisible`. So the panel, which is on the shell side and holds
   * that api, hands the answer down — the same direction `attach` already goes,
   * and no import from `viewport/` into `shell/`.
   */
  setOnScreen(view: Presentation, onScreen: boolean): void {
    if (view.onScreen === onScreen) return;
    view.onScreen = onScreen;
    // The surface is as large as the largest *visible* view, so one appearing or
    // going is a size change like any other.
    this.sizeDirty = true;
  }

  /**
   * The box changed and the surface has not been told yet.
   *
   * A flag rather than an action, and the frame loop is what acts on it.
   * Resizing a WebGPU renderer retires its output target and its swap chain,
   * and doing that from an observer callback puts it at a point in the turn
   * this side does not choose.
   */
  get resizePending(): boolean {
    return this.sizeDirty;
  }

  /** First thing in a frame, so a destroy reported later can be attributed. */
  probe(): void {
    probeFrame(this.renderer, this.editView.host);
  }

  /**
   * Takes every view's box, and sizes the one surface to hold the largest.
   *
   * @returns Whether the edit view's own box moved, which is the one thing the
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
    const editMoved = this.editView.measure();
    // Measured for the side effect, and the answer is not needed by anyone: the
    // game's and the preview's aspects are pushed by the viewport whether or
    // not their panel is the thing that moved.
    this.gameView.measure();
    this.previewView.measure();

    // The largest *visible* view, not the largest box. A parked tab keeps its
    // full size, so counting it kept the surface at 3024 × 1698 while the game
    // drew into a 1904 × 1202 corner of it.
    const shown = [this.editView, this.gameView, this.previewView].filter((view) => view.visible);
    const width = Math.max(0, ...shown.map((view) => view.width));
    const height = Math.max(0, ...shown.map((view) => view.height));

    // Measured, not acted on. Whether a same-size `setSize` is worth skipping is
    // the question the probe is here to answer, and skipping it now would change
    // the behaviour being measured. See `renderProbe`.
    // Nothing moved. `setSize` has no early-out of its own — `CanvasTarget`
    // rewrites `domElement.width`/`height` unconditionally, which reconfigures
    // the WebGPU swap chain even for an identical value — so the one that counts
    // has to live here.
    const changed = width !== this.lastWidth || height !== this.lastHeight;
    probeResize(width, height, changed);
    if (!changed) return editMoved;
    // Nothing is showing a view at all — every panel closed, or every one of
    // them parked. Resizing to zero would destroy the swap chain and hand back a
    // black canvas when a tab comes forward again, so the surface keeps its
    // size and the frame loop simply draws nothing.
    if (width === 0 || height === 0) return editMoved;

    this.lastWidth = width;
    this.lastHeight = height;
    resizeRenderer(this.renderer, width, height);
    return editMoved;
  }

  /** The host that draws `view`'s frames. */
  hostOf(view: Presentation): RenderHost {
    if (view === this.gameView) return this.gameHost;
    return view === this.previewView ? this.previewHost : this.editHost;
  }

  /**
   * Renders one view into its corner of the surface, through its host, and
   * hands its canvas a copy.
   *
   * A view nobody is looking at — on a closed tab, or one behind another — is
   * not drawn at all. A closed one has a zero-sized box; one behind another
   * keeps its box and fails `onScreen` instead. That is the same answer a
   * hidden dock panel gave before by being the panel the canvas was not in,
   * arrived at by measuring rather than by which panel happened to hold the
   * canvas.
   *
   * What it cannot see is which of the Viewport's two canvases is on top: both
   * have the stage's box, and both are on screen with their tab. That is
   * `viewState`'s to say, and the frame loop asks it before calling this.
   *
   * **The corner rule is this class's, not the host's.** Views drawn into
   * corners of one surface is how one renderer serves three canvases, and a
   * host draws into the viewport it is given: with no post effect, nothing it
   * does depends on size. An effect would. `PassNode` sizes its render target
   * from `renderer.getDrawingBufferSize()` (`PassNode.js:801`), and a render
   * *into* a target takes that target's own viewport instead of the one
   * `setViewport` just wrote (`Renderer.js:1619`), so a pass here would draw the
   * scene at the size of the whole surface — the largest visible panel — and
   * squeeze the composite into this view's corner. The first editor effect
   * chooses: its pass sets its own viewport (`PassNode.setViewport`), or the
   * surface follows the drawn view. The launcher and the player draw one view
   * over their whole canvas and never meet it.
   *
   * @returns Whether it drew. For the game's canvas, the first `true` of a
   *   session is its first frame: the moment it has something of its own to
   *   show, which is when it comes on top.
   */
  draw(view: Presentation, scene: Scene, camera: Camera): boolean {
    if (!view.visible) return false;

    // The surface is at least this big — `resize` sized it to the largest
    // visible panel — so the view fits in its corner. `setSize` resets this,
    // which is why it is set per draw rather than per resize.
    this.renderer.setViewport(0, 0, view.width, view.height);
    this.hostOf(view).draw(scene, camera);
    view.show(this.surface, this.renderer.getPixelRatio());
    return true;
  }

  /** @param flySpeed The camera's, which is not this class's to read. */
  reportStats(time: number, flySpeed: number): void {
    this.framesSinceReport += 1;
    if (this.lastReportTime === 0) this.lastReportTime = time;

    const elapsed = time - this.lastReportTime;
    if (elapsed < STATS_INTERVAL_MS) return;

    // Everything the frame drew: three resets `info` once per animation frame,
    // not per render, so a frame that drew more than one view counts them all.
    // The Viewport draws one view a frame, the one `viewState` names as drawn —
    // the edit view, or the game — and the import dialog's preview adds its own
    // while it is open. While the game starts, nothing is drawn until its
    // first frame, and the counters say so: zero.
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
    this.detach(this.editView);
    this.detach(this.gameView);
    this.detach(this.previewView);
    for (const host of [this.editHost, this.gameHost, this.previewHost]) host.dispose();
    this.renderer.dispose();
  }

  /**
   * Moves one view's canvas into its host.
   *
   * A canvas per view rather than one shared canvas handed back and forth,
   * which is what the editor's Scene and Game panels once did: whichever
   * unmounted last took the canvas away from the one that had just claimed it,
   * so each had to know about play state to keep out of the other's way. Each
   * view now owns its own element, and the input that listens on it.
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
    // Back to the default, so a panel that is attached again draws its first
    // frame rather than inheriting a verdict about the element it used to be in.
    view.onScreen = true;
    // The surface is as large as the largest visible panel, so one going away
    // is a size change like any other.
    this.sizeDirty = true;
  }
}
