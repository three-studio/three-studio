import {
  capabilitiesOf,
  createRenderingSettings,
  deserializeScene,
  resolveScene,
  type ExpandedScene,
  type RenderingSettings,
  type SceneDoc,
} from '@three-studio/core';
import {
  Engine,
  FIXED_STEP,
  SceneHost,
  createRenderer,
  studioTime,
  type RendererBackend,
  type SceneBinder,
} from '@three-studio/runtime';
import {
  PerspectiveCamera,
  Vector3,
  type Camera,
  type Group,
  type Scene,
  type WebGPURenderer,
} from 'three/webgpu';
import {
  editorAssetResolver,
  useAssetStore,
} from '../state/assetStore';
import { editorAudioContext } from '../audio/context';
import { audioPreview } from '../audio/preview';
import { useOverlayStore } from '../state/overlayStore';
import { currentSceneName } from '../commands/sceneFiles';
import { timescaleFor } from './timescale';
import { useDocumentStore } from '../state/documentStore';
import { expandedScene } from '../state/expansion';
import { Selection } from '../state/selection';
import { inPrefabMode, usePrefabModeStore } from '../state/prefabModeStore';
import { useProjectStore } from '../state/projectStore';
import { useScriptStore } from '../state/scriptStore';
import { useEditorStore } from '../state/editorStore';
import { useViewportStore } from '../state/viewportStore';
import { FlyControls } from './FlyControls';
import { GizmoController } from './GizmoController';
import { horizontalPlaneHit } from './dropPlane';
import { Picker } from './Picker';
import { installRenderProbe, probeFrame, probeResize } from './renderProbe';
import { retireFrameBufferTarget } from './frameBufferTarget';
import { createEditorProjection } from './editorProjection';
import { Presentation } from './Presentation';
import type { SelectionOutline } from './SelectionOutline';
import type { ViewportOverlay } from './overlay/ViewportOverlay';

const STATS_INTERVAL_MS = 500;
/** Guards against runaway movement after the window was backgrounded. */
const MAX_FRAME_DELTA = 0.1;
/** Reused per frame to keep the selection sync allocation-free. */
const SCRATCH_SIZE = new Vector3();
const SCRATCH_DIRECTION = new Vector3();

/**
 * The editor's 3D view: renderer, camera, navigation and the helper geometry
 * that is not part of the scene document (grid, and later gizmos).
 *
 * It owns the one renderer this document is allowed — a second `WebGPURenderer`
 * drawing in the same frame destroys this one's output target — and draws every
 * view through it, into a surface no panel holds. What a panel shows is a copy
 * of its own corner of that surface; see `Presentation`. That is what lets the
 * Scene and the Game be on screen together.
 */
export class EditorViewport {
  /**
   * The Scene view's projection, built by `createEditorProjection`: the scene
   * graph, the binder that fills it and the overlays laid over it. Everything
   * on the four lines below is that call's, held here for the frame loop.
   */
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly controls: FlyControls;
  readonly backend: RendererBackend;

  /**
   * The Scene view's panel, and what the editor's pointer and keyboard work
   * against — the canvas of the panel the handles are actually drawn in.
   */
  private readonly sceneView = new Presentation('scene');
  /** The running game's panel. The engine's `Input` listens on its canvas. */
  private readonly gameView = new Presentation('game');
  /**
   * The third view: a scene of somebody else's, drawn through this renderer.
   *
   * Today that is the import dialog's model preview, and it is the whole of
   * `attachPreview`'s reason to exist — see there.
   */
  private readonly previewView = new Presentation('preview');
  /** What the third view is currently showing, or null while nothing is. */
  private preview: {
    scene: Scene;
    camera: PerspectiveCamera;
    onFrame: () => void;
  } | null = null;

  /**
   * Projects the scene document onto three.js objects. The resolver reads the
   * asset store lazily, so it stays correct as assets are imported.
   */
  readonly binder: SceneBinder;
  /**
   * Markers on what draws nothing, helpers on what is selected.
   *
   * Declared before `picker` and built before it too: a marker is the click
   * target for a light or a camera, so the picker needs its root at
   * construction.
   */
  readonly overlay: ViewportOverlay;
  readonly picker: Picker;
  /** What the last expansion produced; see `expandDirty`. */
  private lastSources: ExpandedScene['sources'] = new Map();
  /** This consumer's own place in the document's revision log. */
  private lastSeen = 0;
  readonly gizmo: GizmoController;

  private readonly outline: SelectionOutline;
  private readonly fallbackLighting: Group;
  private readonly renderer: WebGPURenderer;
  /**
   * Where the renderer draws, and it is in no document.
   *
   * Everything on screen is a copy taken out of a corner of this. It is as big
   * as the largest panel showing a view, never bigger: resizing it retires
   * three's tone-mapping target, which is what `retireFrameBufferTarget` is
   * about, so it is a thing to do when a panel moves and not per frame.
   */
  private readonly surface: HTMLCanvasElement;
  /** Non-null while the game is running; owns its own scene graph and physics. */
  private engine: Engine | null = null;
  /** Owns the engine while playing, and moves between scenes. */
  private host: SceneHost | null = null;
  /** The document as it was when Play was pressed, restored on Stop. */
  private playSnapshot: SceneDoc | null = null;
  private unsubscribePlayState: (() => void) | null = null;
  /** Pointer-down position, to tell a click apart from a camera drag. */
  private pointerDownAt: { x: number; y: number; button: number } | null = null;
  /**
   * True from the press that starts a camera move until its release.
   *
   * The gizmo is switched off for the whole gesture, not just while
   * `isNavigating` is true: pan and orbit never set that flag, and the frame
   * loop would hand the handles back mid-drag.
   */
  private navigating = false;
  /**
   * Removes every listener this class puts on the canvas and the window.
   *
   * A signal rather than four stored handlers: the four below were installed as
   * anonymous closures and never removed, which is invisible while the canvas
   * is a singleton and a leak the moment it is not.
   */
  private readonly listeners = new AbortController();
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
  private lastFrameTime = 0;
  private framesSinceReport = 0;
  private lastReportTime = 0;
  private disposed = false;

  static async create(): Promise<EditorViewport> {
    // The renderer's own canvas, which no panel ever holds and which therefore
    // needs neither a class nor a tab index: what is on screen is a copy of a
    // corner of it, taken by `Presentation`.
    const surface = document.createElement('canvas');

    /*
     * The project's own settings, so the viewport shows what a build will —
     * read once, here, and carried from here to everything this viewport
     * builds. Play mode reads the same object rather than the store again, so
     * pressing Play cannot pick up a different answer than the Scene view is
     * already showing. That is the whole of this task: one reading, one answer.
     */
    const rendering =
      useProjectStore.getState().project?.settings.rendering ?? createRenderingSettings();
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
    return new EditorViewport(surface, renderer, backend, rendering);
  }

  private constructor(
    surface: HTMLCanvasElement,
    renderer: WebGPURenderer,
    backend: RendererBackend,
    private readonly rendering: RenderingSettings,
  ) {
    this.surface = surface;
    this.renderer = renderer;
    this.backend = backend;

    /*
     * Built here rather than as a field initialiser, because a field
     * initialiser runs before the constructor has been told anything — which is
     * exactly why these settings used to be assigned onto a finished binder,
     * one statement each, in an order nothing enforced.
     *
     * The document goes in at construction, so this viewport's first frame is
     * not also its first sync. `lastSeen` stays at zero regardless: the frame
     * loop's own pass is what records `lastSources`, and skipping it would
     * leave a prefab instance's produced ids unknown to the very next edit.
     */
    const projection = createEditorProjection({
      scene: expandedScene().scene,
      resolver: editorAssetResolver,
      rendering,
      // The one thing the binder cannot do without a device; see `SceneBinder`.
      renderer,
      // Shared materials are pushed in rather than pulled: the binder builds a
      // mesh synchronously, so it cannot await one.
      materials: useAssetStore.getState().materials,
    });
    this.scene = projection.scene;
    this.binder = projection.binder;
    this.overlay = projection.overlay;
    this.outline = projection.outline;
    this.fallbackLighting = projection.fallbackLighting;

    this.camera = new PerspectiveCamera(60, 1, 0.1, 5000);
    this.camera.position.set(8, 6, 12);
    this.camera.lookAt(0, 0, 0);

    // Before both, and it has to stay before both: listeners on the target
    // element run in registration order, so this is the only way the
    // arbitration actually arbitrates. See `installPointerArbitration`.
    this.installPointerArbitration();

    this.controls = new FlyControls(this.camera, this.sceneView.canvas);
    // B11: `locked` was documented as "excluded from picking" and read by
    // nobody. One rule, `capabilitiesOf`, answers here and at the gizmo below.
    this.picker = new Picker(
      this.binder,
      (entityId) => {
        const scene = expandedScene().scene;
        return (
          scene.entities[entityId] === undefined ||
          capabilitiesOf(scene, entityId).has('translate')
        );
      },
      // A light and a camera have no geometry, so the raycast can only ever find
      // their marker. Tested before the scene — see `Picker.pickOverlay`.
      this.overlay.markers,
    );
    this.gizmo = new GizmoController(this.camera, this.sceneView.canvas);
    // Into the group the projection reserved for it, because `TransformControls`
    // needs a canvas and the projection is built without one. The pivot goes in
    // too: `TransformControls` tracks the world matrix of what it is attached
    // to, and an object outside the graph never gets one.
    projection.transformGizmo.add(this.gizmo.helper, this.gizmo.pivotObject);

    this.installSelectionHandlers();
    this.resizeObserver = new ResizeObserver(() => (this.sizeDirty = true));

    useViewportStore.getState().setBackend(backend);
    this.watchPlayState();
    // Owning the loop is what earns the right to own the clock: this is where
    // three's `time` node stops reading `performance.now()` and starts reading
    // the simulation. Once per viewport, and the viewport is once per document.
    studioTime.install();
    void this.renderer.setAnimationLoop((time) => this.tick(time));
  }

  /**
   * Starts and stops the game in response to the transport buttons.
   *
   * The engine is created here rather than in a React component because it
   * draws through this renderer, and this document only gets one: a second
   * `WebGPURenderer` in the same frame destroys this one's output target every
   * frame. It has a canvas of its own, though — the Game panel's.
   */
  private watchPlayState(): void {
    let previous = useEditorStore.getState().playState;

    this.unsubscribePlayState = useEditorStore.subscribe((state) => {
      const next = state.playState;
      if (next === previous) return;

      const wasStopped = previous === 'stopped';
      previous = next;

      if (next === 'stopped') this.endPlay();
      else if (wasStopped) void this.beginPlay();
    });
  }

  private async beginPlay(): Promise<void> {
    // Play means run the game, and a prefab on its own is not one — it usually
    // has no camera and no light, so it would come up black and warn about it.
    // Closing saves the prefab, so nothing is lost by leaving on the way.
    if (inPrefabMode()) await usePrefabModeStore.getState().exit();

    const document = useDocumentStore.getState();
    // Snapshot before anything runs: physics and scripts mutate the world, and
    // Stop has to put the scene back exactly as it was authored.
    this.playSnapshot = structuredClone(document.scene);

    // Compiled fresh on every Play, so editing a script and pressing Play is
    // the whole loop — no build step to remember.
    const compiled = await useScriptStore.getState().build();
    if (!compiled) {
      // Refused rather than started, as Unity refuses to enter play mode on a
      // compile error. Starting anyway means playing a build that does not
      // match the code on screen.
      // Stopped first: leaving play clears the warning list, so the message has
      // to be written after that or it is wiped the instant it appears.
      useEditorStore.getState().stop();
      useViewportStore
        .getState()
        .setPlayWarnings(['Scripts did not compile — see the Console.']);
      return;
    }

    try {
      // Hosted rather than created directly, so a script can move to another
      // scene while playing in the editor — a menu that starts a level has to
      // be testable without exporting a build first. The scene it starts on is
      // the document being edited, not `startScene`: pressing Play means "run
      // what is on screen".
      const host = new SceneHost({
        source: {
          // By id or by name, never by path: a build renames the entry scene
          // and files the rest elsewhere, so a script naming a path would work
          // here and break once exported.
          read: async (idOrName) => {
            const entry = resolveScene(useProjectStore.getState().scenes, idOrName);
            if (!entry) throw new Error(`No scene "${idOrName}" in this project.`);
            return deserializeScene(await window.studio.project.readScene(entry.path));
          },
        },
        loadingScene: useProjectStore.getState().project?.settings.loadingScene ?? null,
        resolver: editorAssetResolver,
        physicsSettings: useProjectStore.getState().project?.settings.physics,
        // The viewport's own, not the store's: Play has to draw with what the
        // Scene view is drawing with, and re-reading is how they came apart.
        rendering: this.rendering,
        // Without this a mesh linked to a material asset would play with its
        // embedded material — the scene would look different the moment you
        // pressed Play, for no reason the author could see.
        materials: useAssetStore.getState().materials,
        prefabs: useAssetStore.getState().prefabs,
        // Play mode draws on this same renderer, so the running scene captures
        // its sky on the device the editor already holds.
        renderer: this.renderer,
        // The Game panel's own canvas. The two views had to share one until
        // they could be drawn separately, and sharing it is what made pressing
        // Play hand the editor's pointer handling over to the game's.
        domElement: this.gameView.canvas,
        // The editor's one context, shared with the preview and kept apart from
        // it by a root gain each (ADR-4). `undefined` where there is no Web
        // Audio, which makes the game silent rather than broken.
        audioContext: editorAudioContext() ?? undefined,
      });
      this.host = host;

      // The document, not the expansion: the host expands every scene it runs,
      // and handing it one already expanded would do the work twice.
      // The name, which is what a script comparing `scenes.current` reads. It
      // is the indicative half of a scene's identity — see ADR-15 — and a
      // script that wants the stable half can name the id instead.
      await host.adopt(currentSceneName(), document.scene);
      const engine = host.engine;
      if (!engine) return;

      // A script may swap scenes at any point; the viewport renders through
      // whatever is current rather than the one it started with.
      host.onSceneChanged = (_path, next) => {
        this.engine = next;
        next.onWarning = (warnings) => {
          useViewportStore.getState().setPlayWarnings(warnings);
        };
        this.syncGameAspect(next);
      };
      if (useEditorStore.getState().playState === 'stopped') {
        // Stopped again while the physics module was loading. The host goes
        // too, and `this.host` is cleared: `endPlay` may already have run —
        // `this.host` was still null when it did, because the assignment above
        // happens after two awaits — and it would then never be taken down.
        host.dispose();
        if (this.host === host) this.host = null;
        return;
      }
      // A copy, and a live subscription: warnings raised later must reach the
      // panel, and React only redraws on a new reference.
      engine.onWarning = (warnings) => {
        useViewportStore.getState().setPlayWarnings(warnings);
      };
      this.engine = engine;
      // Pressing Play is the user gesture, which is the only moment a browser
      // will start an audio context. Missing it means a game that is silent
      // until something else happens to be clicked, with nothing to say why.
      void engine.audio?.unlock();
      // Not because they would fight the game for the pointer — each view has
      // its own canvas now — but because the Scene view is a *view* while the
      // game runs: flying it or dragging a handle would edit a document that
      // Stop is about to put back the way it was.
      this.controls.setEnabled(false);
      this.gizmo.setEnabled(false);
      useViewportStore.getState().setPlayWarnings([...engine.warnings]);
      // The engine needs the viewport aspect; the frame loop hands it over on
      // the next tick rather than resizing the renderer from here.
      this.sizeDirty = true;
    } catch (cause) {
      useViewportStore
        .getState()
        .setError(cause instanceof Error ? cause.message : String(cause));
      useEditorStore.getState().stop();
    }
  }

  private endPlay(): void {
    // The host owns the engine once playing; disposing both would tear the
    // same one down twice.
    this.host?.dispose();
    this.host = null;
    this.engine = null;
    this.controls.setEnabled(true);
    useViewportStore.getState().setPlayWarnings([]);

    if (this.playSnapshot) {
      useDocumentStore.getState().replaceScene(this.playSnapshot, { keepHistory: true });
      this.playSnapshot = null;
    }
  }

  /** Show the Scene view in this panel. Safe to call repeatedly. */
  attachScene(host: HTMLElement): void {
    this.attachView(this.sceneView, host);
  }

  detachScene(): void {
    this.detachView(this.sceneView);
  }

  /** Show the running game in this panel. Safe to call repeatedly. */
  attachGame(host: HTMLElement): void {
    this.attachView(this.gameView, host);
  }

  detachGame(): void {
    this.detachView(this.gameView);
  }

  /**
   * Lends the third view to a scene this viewport knows nothing else about, and
   * hands back the canvas it will land in.
   *
   * The import dialog's model preview is what this is for. It used to open a
   * **second `WebGPURenderer`** of its own, and two of those drawing inside one
   * animation frame destroy and rebuild each other's output target every frame
   * — so the viewport counted the renderers on the page and stood down for as
   * long as it was not alone. On screen that read as the viewport freezing the
   * moment the import dialog opened. One renderer with several presentations is
   * the answer to both, and the mechanism already existed for the Scene and the
   * Game; this is a third caller of it.
   *
   * The canvas comes back because a preview builds its own `OrbitControls`, and
   * controls need an element. `onFrame` runs once per frame immediately before
   * the draw: damped controls have to be updated every frame, and doing it from
   * a loop of the caller's own would put it outside the frame the render
   * belongs to, which is the mistake this whole seam exists to stop making.
   */
  attachPreview(
    host: HTMLElement,
    scene: Scene,
    camera: PerspectiveCamera,
    onFrame: () => void,
  ): HTMLCanvasElement {
    this.preview = { scene, camera, onFrame };
    this.attachView(this.previewView, host);
    return this.previewView.canvas;
  }

  detachPreview(): void {
    this.preview = null;
    this.detachView(this.previewView);
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
  private attachView(view: Presentation, host: HTMLElement): void {
    if (this.disposed || view.host === host) return;
    this.detachView(view);
    view.host = host;
    host.appendChild(view.canvas);
    this.resizeObserver.observe(host);
    this.sizeDirty = true;
  }

  private detachView(view: Presentation): void {
    const host = view.host;
    if (!host) return;
    this.resizeObserver.unobserve(host);
    view.canvas.remove();
    view.host = null;
    // The surface is as large as the largest visible panel, so one going away
    // is a size change like any other.
    this.sizeDirty = true;
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.abort();
    this.unsubscribePlayState?.();
    // The host owns the engine, its loads in flight and its preloader. Disposing
    // the engine alone left all three alive, along with the `Input` listening on
    // a canvas that is about to go away.
    this.host?.dispose();
    this.host = null;
    this.engine?.dispose();
    void this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.gizmo.dispose();
    this.outline.dispose();
    this.overlay.dispose();
    this.binder.dispose();
    this.detachScene();
    this.detachGame();
    this.detachPreview();
    this.renderer.dispose();
  }

  /** The running game, or `null` when stopped. Read-only; use the transport. */
  get playEngine(): Engine | null {
    return this.engine;
  }

  /** Frame a world-space sphere; used by the F shortcut and by selection. */
  focus(target: Vector3, radius: number): void {
    this.controls.frame(target, radius);
  }

  /**
   * Where a drop at these client coordinates should place an object: on the
   * surface under the cursor if there is one, otherwise on the horizontal plane
   * through the orbit pivot, otherwise a fixed distance ahead when the camera is
   * looking at the sky.
   *
   * The middle step used to use the plane at `y = 0`, which is the helper grid
   * and nothing else. A floor is finite, so the centre of the screen clears its
   * edge constantly — and every object placed past that edge landed on the grid,
   * floating above the floor the author had actually built.
   *
   * Through the pivot instead, which is where the author's attention is: it
   * starts at the origin, so a fresh scene still drops onto the grid, and it
   * follows the selection, so once the floor has been picked or framed the
   * fallback is at the floor's own height.
   */
  dropPoint(clientX: number, clientY: number): Vector3 {
    const rect = this.sceneView.canvas.getBoundingClientRect();
    const hit = this.picker.raycast(clientX, clientY, rect, this.camera);
    if (hit) return hit;

    const origin = this.camera.position;
    const direction = this.camera.getWorldDirection(SCRATCH_DIRECTION);
    const onPlane = horizontalPlaneHit(origin, direction, this.controls.pivot.y);
    if (onPlane) return onPlane;

    return new Vector3().copy(origin).addScaledVector(direction, 10);
  }

  /**
   * Where an object created from a menu should land: the drop point at the
   * centre of the view.
   *
   * The centre rather than the cursor because the cursor is over the menu when
   * the entry is picked, and nowhere near what the author is looking at. Unity
   * and Unreal both anchor their Add to the middle of the viewport for the
   * same reason.
   */
  placementPoint(): Vector3 {
    const rect = this.sceneView.canvas.getBoundingClientRect();
    return this.dropPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  /**
   * Takes every view's box, and sizes the one surface to hold the largest.
   *
   * Each view is drawn into the top-left corner of the surface at its own size,
   * so the surface has to be as large as the largest of them and there is no
   * reason for it to be larger. Sizing it per view instead — a `setSize` before
   * each render — would retire three's tone-mapping target twice a frame, which
   * is the churn `retireFrameBufferTarget` exists to keep down to one per
   * resize.
   */
  private resize(): void {
    const sceneMoved = this.sceneView.measure();
    // Measured for the side effect, and the answer is not needed: the game's
    // and the preview's aspects are pushed below whether or not their panel is
    // the thing that moved.
    this.gameView.measure();
    this.previewView.measure();

    // Each view's camera answers to its own panel, whatever the surface is.
    if (sceneMoved && this.sceneView.visible) {
      this.camera.aspect = this.sceneView.width / this.sceneView.height;
      this.camera.updateProjectionMatrix();
    }
    // Unconditionally rather than on `gameMoved`, because the engine may have
    // arrived since the last resize: `beginPlay` raises the dirty flag once the
    // engine exists precisely so that this hands it the shape of its panel, and
    // that panel has usually not changed size at all.
    if (this.engine) this.syncGameAspect(this.engine);
    // Unconditionally for the same reason, and for one of its own: selecting
    // another file in the import dialog swaps one preview camera for another
    // without the panel it sits in moving a pixel. A camera that never hears a
    // box keeps the 1:1 aspect it was constructed with.
    if (this.preview && this.previewView.visible) {
      const { camera } = this.preview;
      camera.aspect = this.previewView.width / this.previewView.height;
      camera.updateProjectionMatrix();
    }

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
    if (!changed) return;
    // Nothing is showing a view: a dock panel on a hidden tab reports zero, and
    // resizing to that would destroy the swap chain and hand back a black
    // canvas when the tab comes forward again. The surface keeps its size.
    if (width === 0 || height === 0) return;

    this.lastWidth = width;
    this.lastHeight = height;
    this.renderer.setSize(width, height, false);
    retireFrameBufferTarget(this.renderer);
  }

  /** Hands the running game the shape of the panel it is drawn in. */
  private syncGameAspect(engine: Engine): void {
    if (!this.gameView.visible) return;
    engine.setViewportAspect(this.gameView.width / this.gameView.height);
  }

  /**
   * Whether something owns the whole window, so there is nothing to draw for.
   *
   * A modal is defined by `overlayStore` as a surface that "owns the whole
   * window until it is answered". The scene is behind an opaque panel then, and
   * drawing four thousand draw calls nobody can see is pure waste.
   *
   * What this gives up is that the strip of scene visible through a dialog's
   * 50%-black backdrop holds still. For a scene it is indistinguishable; for one
   * with moving clouds it is a frozen frame in a nine-pixel margin.
   *
   * **It answers for the Scene and the Game, and not for the preview**, which is
   * *inside* the modal — see `tick`.
   *
   * There used to be a second condition here, `rendererCount() > 1`, and it was
   * the mechanism rather than the intent: the import dialog opened a second
   * `WebGPURenderer` for its model preview, two renderers drawing in one frame
   * destroy and rebuild each other's output target, and standing down was the
   * only way out that did not need to guess at frames. The preview draws through
   * this renderer now — `attachPreview` — so there is no second one to count and
   * nothing left here but the question this side can actually answer: is anyone
   * looking. The hazard itself has not gone anywhere; it is written down where
   * the one-renderer rule lives, in `Presentation`.
   */
  private shouldSkipRender(): boolean {
    return useOverlayStore.getState().stack.some((overlay) => overlay.kind === 'modal');
  }

  private tick(time: number): void {
    if (this.disposed) return;

    // First thing in the frame, so a destroy reported later can be attributed to
    // this frame's size or to no size change at all. No-op unless armed.
    probeFrame(this.renderer, this.sceneView.host);

    // Before `beginFrame` and before either render, and *before* the covered
    // check: a viewport parked behind a modal still has to take the new size, or
    // it comes back holding a target built for a box that no longer exists.
    if (this.sizeDirty) {
      this.sizeDirty = false;
      this.resize();
    }

    const covered = this.shouldSkipRender();

    // Once per frame, before anything else can retire more: the previous frame's
    // render has been submitted, so what it may have been reading is now safe to
    // free. B6 — this used to ride on `sync`, which is neither once per frame nor
    // guaranteed to happen at all.
    this.binder.beginFrame();

    const raw = this.lastFrameTime === 0 ? 0 : Math.min((time - this.lastFrameTime) / 1000, MAX_FRAME_DELTA);
    this.lastFrameTime = time;

    const { playState, consumeStep } = useEditorStore.getState();
    // Before anything reads a delta, and before anything draws: every node
    // material in the document is about to sample this. Written here rather
    // than on the transport commands because this is where the state is
    // already read, and it is per frame that it has to be right.
    studioTime.timescale = timescaleFor(playState, useViewportStore.getState().animated);
    studioTime.advance(raw);
    const delta = studioTime.delta;

    const engine = this.engine;
    if (engine) {
      // Paused still renders, so the frame stays live and Step can advance it.
      if (playState === 'playing') engine.update(delta);
      else if (consumeStep()) {
        // The clock too, or the surfaces hold still through a step that moves
        // everything else. `step` is the one thing a zero timescale cannot veto.
        studioTime.step(FIXED_STEP);
        engine.update(FIXED_STEP);
      }

      // Paused means paused, including the part you can hear. The root gain
      // rather than the context, which the preview is sharing.
      engine.audio?.setSuspended(playState !== 'playing');
    } else {
      // `raw`, not the simulated delta: flying the editor camera is not part of
      // the simulation, and a timescale of zero must not nail it to the spot.
      //
      // Only while the Scene view is in a panel: the loop keeps running once it
      // is detached, and integrating a gesture nobody can see is how a stuck key
      // used to travel while the Scene tab was closed.
      if (this.sceneView.host) this.controls.update(raw);
      // The ear rides the editor camera while nothing is running, which is what
      // makes an audition of a positional source worth anything: fly toward the
      // source and it gets louder. A no-op until something has actually been
      // previewed, because the preview builds its engine lazily. Not while the
      // game runs: the ear is the game's then, and two writers of one listener
      // is a mixing bug that sounds like a bad scene.
      audioPreview.setListener(...cameraPose(this.camera));
    }

    // The Scene view is a view of the *document*, playing or not — which is the
    // whole point of being able to see it next to the game. It used to be that
    // pressing Play took the canvas away from this panel, so none of this ran
    // and none of it had to.
    if (this.sceneView.visible) {
      this.syncDocument();
      this.syncSelection();
    }
    // Only while a handle is held: the gizmo moves the object directly and the
    // document catches up a frame later, so without this a batched object
    // lags the handle by a frame. Every other change comes through `sync`,
    // which refreshes the batches itself.
    if (this.gizmo.isEngaged) this.binder.updateBatches();

    // The preview draws whether or not a modal is up, because it is *in* the
    // modal that covers everything else: skipping it would leave the import
    // dialog showing a blank rectangle where the model should be. Its own
    // per-frame work runs here too, in the frame its render belongs to — see
    // `attachPreview`.
    const preview = this.preview;
    if (preview && this.previewView.visible) {
      preview.onFrame();
      this.draw(preview.scene, preview.camera, this.previewView);
    }

    // Simulation carries on; only the drawing stops. Pausing the game because
    // a dialog opened would be a different decision, and not one to take here.
    if (covered) return;

    this.draw(this.scene, this.camera, this.sceneView);
    if (engine) this.draw(engine.scene, engine.activeCamera, this.gameView);
    this.reportStats(time);
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
  private draw(scene: Scene, camera: Camera, view: Presentation): void {
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

  private syncSelection(): void {
    const { selection, transformMode, showGizmos } = useEditorStore.getState();
    const resolve = (id: string) => this.binder.getObject(id);

    this.outline.update(selection, resolve);

    // Bounds first: the gizmo needs them to place its pivot on the centre of the
    // selection, and the outline has just measured them.
    const bounds = this.outline.bounds();

    /*
     * The gizmo drives the whole selection, from a synthetic pivot.
     *
     * The comment that used to sit here claimed Unity moves only the last object
     * clicked. It does not — it moves the whole selection, with the handles on
     * the last one picked. What is true is that a locked member stops the gesture
     * for everyone, which `can('translate')` decides inside the controller from
     * the same rule that greys the menu entry.
     */
    const current = Selection.of(selection, expandedScene().scene);
    /*
     * Not while the game runs, which is new: this used to be reached only when
     * nothing was playing, because Play took the canvas away from this panel.
     * The Scene view is drawn every frame of Play now, and handles that cannot
     * be dragged — `beginPlay` switches them off, and a drag would edit a
     * document Stop is about to put back — must not be drawn either. Leaving
     * `update` to run would draw them: it ends by showing the helper.
     *
     * `isNavigating` only covers the fly gesture; `navigating` covers pan and
     * orbit too, and it is what keeps the handles away for the whole press.
     */
    if (this.engine === null) {
      this.gizmo.setEnabled(!this.controls.isNavigating && !this.navigating);
      this.gizmo.update(current, resolve, bounds, transformMode);
    }

    // `current.ids` rather than the store's: an id naming nothing has already
    // been dropped there, and a marker for it would sit at the origin forever.
    // The measured height, not the panel's current one — it is the height the
    // camera's aspect was built from, and the two differ for a frame after a
    // dock resize.
    this.overlay.update(
      expandedScene().scene,
      current.ids,
      this.camera,
      this.sceneView.height,
      showGizmos,
    );

    // Keep the orbit pivot and the F shortcut on the selection.
    if (bounds) {
      bounds.getCenter(this.controls.pivot);
      this.controls.focusRadius = Math.max(bounds.getSize(SCRATCH_SIZE).length() * 0.5, 0.5);
    }
  }

  /**
   * Decides who owns a press, before either library sees it.
   *
   * Registered first, and that is the whole point: on the target element every
   * listener runs in registration order regardless of the capture flag, so this
   * only arbitrates if it is installed before `FlyControls` and
   * `TransformControls`. It used to be installed last, and the comment claiming
   * otherwise was simply wrong.
   *
   * What it cost: right-dragging to fly with something selected threw
   * `InvalidStateError: Failed to execute 'setPointerCapture'`. FlyControls
   * claimed the pointer and asked for the lock; `TransformControls` then ran on
   * the same press, saw `document.pointerLockElement` still null — the request
   * is asynchronous — and captured a pointer the browser had already retired
   * for the lock transition.
   */
  private installPointerArbitration(): void {
    const { signal } = this.listeners;

    this.sceneView.canvas.addEventListener(
      'pointerdown',
      (event) => {
        if (this.engine) return;

        // Right, middle and Alt+left move the camera. The gizmo has no business
        // with any of them, and letting it capture the pointer is what threw.
        this.navigating =
          event.button === 2 || event.button === 1 || (event.button === 0 && event.altKey);
        if (this.navigating) this.gizmo.setEnabled(false);

        // The other direction: a press that starts on a gizmo handle must not
        // also move the camera.
        this.controls.setEnabled(!this.gizmo.isEngaged);
        this.pointerDownAt = { x: event.clientX, y: event.clientY, button: event.button };
      },
      { signal },
    );

    /**
     * The press latches `navigating` and may switch the camera off; only this
     * unlatches both, so it has to run for every way a press can end.
     *
     * It used to listen on the canvas, which is not where a release
     * necessarily lands: dockview parks each panel in its own render overlay
     * and reparents it, and a reparent drops the pointer capture that was
     * bringing the release back. A release the canvas never saw left the
     * camera disabled and the gizmo hidden with no path back — the state the
     * user could only clear by closing the Scene tab.
     */
    const endGesture = () => {
      this.navigating = false;
      if (!this.engine) this.controls.setEnabled(true);
    };
    window.addEventListener('pointerup', endGesture, { signal });
    window.addEventListener('pointercancel', endGesture, { signal });
    this.sceneView.canvas.addEventListener('lostpointercapture', endGesture, { signal });
  }

  /**
   * Click-to-select. A click is a press and release that did not move far —
   * anything else is a camera drag, and the gizmo takes priority over both.
   */
  private installSelectionHandlers(): void {
    this.sceneView.canvas.addEventListener(
      'pointerup',
      (event) => {
        const down = this.pointerDownAt;
        this.pointerDownAt = null;
        // Clicking in the game view captures the mouse; it must not also select.
        if (this.engine) return;

        if (!down || down.button !== 0 || event.button !== 0) return;
        if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) return;
        if (this.gizmo.isEngaged || event.altKey) return;

        const entityId = this.picker.pick(
          event.clientX,
          event.clientY,
          this.sceneView.canvas.getBoundingClientRect(),
          this.camera,
        );

        const store = useEditorStore.getState();
        if (entityId === undefined) {
          store.clearSelection();
        } else if (event.shiftKey || event.metaKey || event.ctrlKey) {
          const selection = store.selection;
          store.setSelection(
            selection.includes(entityId)
              ? selection.filter((id) => id !== entityId)
              : [...selection, entityId],
          );
        } else {
          store.setSelection([entityId]);
        }
      },
      { signal: this.listeners.signal },
    );
  }

  private reportStats(time: number): void {
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
    useViewportStore.getState().setFlySpeed(this.controls.moveSpeed);

    this.framesSinceReport = 0;
    this.lastReportTime = time;
  }

  /**
   * Pulls the scene document into three.js once per frame.
   *
   * Batching here rather than subscribing to the store means a burst of
   * mutations (a multi-entity paste, an undo of a structural change) costs one
   * reconcile, and the graph is always in sync with what is about to be drawn.
   */
  /**
   * True when an entity carrying a prefab instance changed.
   *
   * The dirty set names document entities; an instance's contents are derived
   * and have ids the document has never heard of, so a change to one cannot be
   * expressed there.
   */
  /**
   * The ids the binder has to re-read, including the ones no document names.
   *
   * An instance's contents are derived, so `dirtyEntities` — collected from the
   * document — can never mention them. The first answer to that was to
   * reconcile the whole scene whenever any instance changed, and it cost 426ms
   * per edit at two thousand instances: the editor became unusable at exactly
   * the scale prefabs exist for.
   *
   * The expansion already records what each instance produced, so the ids are
   * there to be named. Both expansions are consulted: an instance pointed at a
   * different prefab produces different ids, and the ones it used to produce
   * have to be taken down.
   */
  private expandDirty(
    dirty: ReadonlySet<string> | undefined,
    sources: ExpandedScene['sources'],
  ): ReadonlySet<string> | undefined {
    if (dirty === undefined) return undefined;

    const expanded = new Set(dirty);
    for (const id of dirty) {
      for (const made of this.lastSources.get(id)?.produced.entities ?? []) expanded.add(made.id);
      for (const made of sources.get(id)?.produced.entities ?? []) expanded.add(made.id);
    }
    return expanded;
  }

  private syncDocument(): void {
    const state = useDocumentStore.getState();
    // Its own place in the log, asked for and never cleared. The old channel was
    // a shared buffer that the first consumer to run emptied for everyone else,
    // which is why there could only ever be one viewport.
    const changes = state.changesSince(this.lastSeen);
    this.lastSeen = changes.revision;

    const entities = changes.entities === '*' ? undefined : changes.entities;
    const touchedEntities = entities === undefined || entities.size > 0;
    if (!touchedEntities && !changes.environment && !changes.materials && !changes.prefabs) return;

    // The binder, the picker and the physics world all take a plain `SceneDoc`.
    // Expanding here is what keeps them from each needing to know what a prefab
    // is; the shared expansion hands back the same entity objects for anything
    // untouched, so nothing gets rebuilt.
    const expanded = expandedScene();
    const scene = expanded.scene;

    /*
     * A library change is not an entity change, and that distinction is the
     * point of carrying it separately.
     *
     * Editing a material or a prefab touches no entity, yet changes what is
     * drawn — the expansion reads the prefab table as well as the document. It
     * used to be handled by two out-of-band `binder.sync(expandedScene().scene)`
     * calls with no dirty set at all, i.e. a full reconcile per material tint;
     * and `assetStore.refresh` fires both in one microtask, so the second freed
     * what the first had retired. That was B6's other half.
     */
    /*
     * A material edit names no entity, and it does not have to: the binder knows
     * exactly which bindings it just invalidated and hands them back. That is
     * the reconcile this phase set out to remove — two full passes per tint,
     * fired out of band and in the same microtask.
     *
     * A prefab edit is the other case. It changes what the *expansion produces*,
     * so entities appear and vanish and there is nothing to name: the pass stays
     * full. Which is why the channel carries the two tables apart.
     */
    const invalidated = changes.materials
      ? this.binder.setMaterialLibrary(useAssetStore.getState().materials)
      : new Set<string>();

    const dirty = changes.prefabs ? undefined : this.expandDirty(entities, expanded.sources);
    const merged = dirty === undefined ? undefined : new Set([...dirty, ...invalidated]);
    // Recorded after the dirty set is built: a deleted instance is only in the
    // previous expansion, and that is where its contents are named.
    this.lastSources = expanded.sources;

    this.binder.sync(scene, merged);
    // The same dirty set, and for the same reason: deciding whether an entity
    // carries a marker means reading the entity table, which is exactly the scan
    // ADR-16 kept out of the frame loop. What runs per frame is only the placing.
    this.overlay.sync(scene, merged);
    if (changes.environment) this.binder.syncEnvironment(this.scene, scene);

    // A scene with no lights of its own would render black, which reads as a
    // bug rather than as "you have not added a light yet".
    //
    // B12: asked of the *expanded* scene. A level whose lights all come from
    // prefab instances has none in the document, so the fallback pair stayed on
    // over the real ones — every such scene lit twice.
    // A table lookup: it used to walk every entity and every component of each,
    // once per sync.
    const hasAuthoredLight = Object.keys(scene.components.light).length > 0;
    this.fallbackLighting.visible = !hasAuthoredLight;
    // And published, because the pair is editor-only: the same document is
    // black in Play and in a build. `Engine.create` says the other half of this
    // sentence, on the screen where that half is the one that matters.
    useViewportStore.getState().setFallbackLighting(!hasAuthoredLight);
  }
}

/**
 * The camera as three numbers each, for the audio listener.
 *
 * −Z forward and +Y up, read off the world matrix — the same convention the
 * runtime behaviour and the gizmo use, so all three agree by construction.
 */
function cameraPose(
  camera: PerspectiveCamera,
): [[number, number, number], [number, number, number], [number, number, number]] {
  camera.updateWorldMatrix(true, false);
  const e = camera.matrixWorld.elements;
  const unit = (x: number, y: number, z: number): [number, number, number] => {
    const length = Math.hypot(x, y, z) || 1;
    return [x / length, y / length, z / length];
  };
  return [
    [e[12] ?? 0, e[13] ?? 0, e[14] ?? 0],
    unit(-(e[8] ?? 0), -(e[9] ?? 0), -(e[10] ?? 1)),
    unit(e[4] ?? 0, e[5] ?? 1, e[6] ?? 0),
  ];
}
