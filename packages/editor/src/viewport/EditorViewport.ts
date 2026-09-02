import {
  capabilitiesOf,
  deserializeScene,
  resolveScene,
  type ExpandedScene,
  type SceneDoc,
} from '@three-studio/core';
import {
  Engine,
  FIXED_STEP,
  SceneBinder,
  SceneHost,
  createRenderer,
  rendererCount,
  studioTime,
  type RendererBackend,
} from '@three-studio/runtime';
import {
  Color,
  DirectionalLight,
  Group,
  GridHelper,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  Vector3,
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
import { SelectionOutline } from './SelectionOutline';
import { ViewportOverlay } from './overlay/ViewportOverlay';

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
 * It owns a single canvas which is moved between dock panels rather than
 * recreated, because a second WebGPU device is expensive and the Scene and Game
 * tabs are never visible at the same time.
 */
export class EditorViewport {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  readonly controls: FlyControls;
  readonly backend: RendererBackend;

  /** Editor-only geometry, excluded from picking and from the exported scene. */
  readonly helpers = new Group();

  /**
   * Projects the scene document onto three.js objects. The resolver reads the
   * asset store lazily, so it stays correct as assets are imported.
   */
  readonly binder = new SceneBinder(editorAssetResolver);
  /**
   * Markers on what draws nothing, helpers on what is selected.
   *
   * Declared before `picker` and built before it too: a marker is the click
   * target for a light or a camera, so the picker needs its root at
   * construction.
   */
  readonly overlay = new ViewportOverlay(this.binder);
  readonly picker: Picker;
  /** What the last expansion produced; see `expandDirty`. */
  private lastSources: ExpandedScene['sources'] = new Map();
  /** This consumer's own place in the document's revision log. */
  private lastSeen = 0;
  readonly gizmo: GizmoController;

  private readonly outline = new SelectionOutline();
  private readonly fallbackLighting = new Group();
  private readonly renderer: WebGPURenderer;
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
  private readonly resizeObserver: ResizeObserver;
  private container: HTMLElement | null = null;
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
    const canvas = document.createElement('canvas');
    canvas.className = 'block h-full w-full outline-none';
    // Focusable so the viewport can own keyboard input while it is hovered.
    canvas.tabIndex = 0;

    // The project's own settings, so the viewport shows what a build will.
    const rendering = useProjectStore.getState().project?.settings.rendering;
    const { renderer, backend } = await createRenderer({
      canvas,
      forceWebGL: rendering?.forceWebGL,
      antialias: rendering?.antialias,
      maxPixelRatio: rendering?.maxPixelRatio,
      shadows: rendering?.shadows,
      exposure: rendering?.exposure,
    });
    // Off unless `studio.probe.render` is set in localStorage; see `renderProbe`.
    installRenderProbe(renderer);
    return new EditorViewport(canvas, renderer, backend);
  }

  private constructor(canvas: HTMLCanvasElement, renderer: WebGPURenderer, backend: RendererBackend) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.backend = backend;

    this.camera = new PerspectiveCamera(60, 1, 0.1, 5000);
    this.camera.position.set(8, 6, 12);
    this.camera.lookAt(0, 0, 0);

    this.scene.background = new Color('#2b2f33');
    this.scene.add(this.helpers, this.fallbackLighting, this.binder.root);
    // The one thing the binder cannot do without a device; see `SceneBinder`.
    this.binder.renderer = renderer;

    // Shared materials are pushed in rather than pulled: the binder builds a
    // mesh synchronously, so it cannot await one. A full reconcile follows
    // because `setMaterialLibrary` only invalidates the affected bindings — it
    // has no way to schedule the rebuild itself.
    this.binder.shadowMapSize =
      useProjectStore.getState().project?.settings.rendering.shadowMapSize ??
      this.binder.shadowMapSize;
    // On here too, now that a click on a batch resolves to the instance it hit.
    // The outline and the gizmo were never affected: both work off the entity's
    // container, which a batched mesh still hangs from.
    this.binder.batching = true;
    this.binder.setMaterialLibrary(useAssetStore.getState().materials);
    this.buildHelpers();
    this.buildFallbackLighting();

    // Before both, and it has to stay before both: listeners on the target
    // element run in registration order, so this is the only way the
    // arbitration actually arbitrates. See `installPointerArbitration`.
    this.installPointerArbitration();

    this.controls = new FlyControls(this.camera, canvas);
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
    this.gizmo = new GizmoController(this.camera, canvas);
    // The pivot goes in too: `TransformControls` tracks the world matrix of what
    // it is attached to, and an object outside the graph never gets one.
    this.helpers.add(
      this.outline.root,
      this.gizmo.helper,
      this.gizmo.pivotObject,
      // Both under `helpers`, whose transform is identity — three's light and
      // camera helpers take the world matrix of what they annotate as their own,
      // and a parent with a transform would offset every one of them.
      this.overlay.markers,
      this.overlay.annotations,
    );

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
   * shares this renderer and canvas — a second renderer would mean a second
   * WebGPU device for a view that is never visible at the same time.
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
            const project = useProjectStore.getState().project;
            const entry = project ? resolveScene(project, idOrName) : undefined;
            if (!entry) throw new Error(`No scene "${idOrName}" in this project.`);
            return deserializeScene(await window.studio.project.readScene(entry.path));
          },
        },
        loadingScene: useProjectStore.getState().project?.settings.loadingScene ?? null,
        resolver: editorAssetResolver,
        physicsSettings: useProjectStore.getState().project?.settings.physics,
        // Without this a mesh linked to a material asset would play with its
        // embedded material — the scene would look different the moment you
        // pressed Play, for no reason the author could see.
        materials: useAssetStore.getState().materials,
        prefabs: useAssetStore.getState().prefabs,
        // Play mode draws on this same renderer, so the running scene captures
        // its sky on the device the editor already holds.
        renderer: this.renderer,
        domElement: this.canvas,
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
        next.setViewportAspect(this.canvas.clientWidth / Math.max(this.canvas.clientHeight, 1));
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
      // The editor camera and gizmo share this canvas. Left running they would
      // fight the game for the pointer — and the right button would hand the
      // pointer lock to the editor's fly camera mid-play.
      this.controls.enabled = false;
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
    this.controls.enabled = true;
    useViewportStore.getState().setPlayWarnings([]);

    if (this.playSnapshot) {
      useDocumentStore.getState().replaceScene(this.playSnapshot, { keepHistory: true });
      this.playSnapshot = null;
    }
  }

  /** Move the canvas into a dock panel. Safe to call repeatedly. */
  attach(container: HTMLElement): void {
    if (this.disposed || this.container === container) return;
    this.detach();
    this.container = container;
    container.appendChild(this.canvas);
    this.resizeObserver.observe(container);
    this.sizeDirty = true;
  }

  detach(): void {
    if (!this.container) return;
    this.resizeObserver.unobserve(this.container);
    this.canvas.remove();
    this.container = null;
  }

  dispose(): void {
    this.disposed = true;
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
    this.detach();
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
    const rect = this.canvas.getBoundingClientRect();
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
    const rect = this.canvas.getBoundingClientRect();
    return this.dropPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  private resize(): void {
    const container = this.container;
    if (!container) return;

    const { clientWidth, clientHeight } = container;
    // A dock panel on a hidden tab reports zero; resizing to it would destroy
    // the swap chain and produce a black canvas when the tab comes back.
    if (clientWidth === 0 || clientHeight === 0) return;

    // Measured, not acted on. Whether a same-size `setSize` is worth skipping is
    // the question the probe is here to answer, and skipping it now would change
    // the behaviour being measured. See `renderProbe`.
    // Nothing moved. `setSize` has no early-out of its own — `CanvasTarget`
    // rewrites `domElement.width`/`height` unconditionally, which reconfigures
    // the WebGPU swap chain even for an identical value — so the one that counts
    // has to live here.
    const changed = clientWidth !== this.lastWidth || clientHeight !== this.lastHeight;
    probeResize(clientWidth, clientHeight, changed);
    if (!changed) return;
    this.lastWidth = clientWidth;
    this.lastHeight = clientHeight;

    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
    this.engine?.setViewportAspect(clientWidth / clientHeight);
    this.renderer.setSize(clientWidth, clientHeight, false);
    retireFrameBufferTarget(this.renderer);
  }

  /**
   * Whether something owns the whole window, so there is nothing to draw for.
   *
   * A modal is defined by `overlayStore` as a surface that "owns the whole
   * window until it is answered", and the import dialog is one. Skipping the
   * render while one is up is worth it twice over.
   *
   * The cheap half: the scene is behind an opaque panel, and drawing four
   * thousand draw calls nobody can see is pure waste.
   *
   * The half that is not cheap at all: the import dialog opens **a second
   * WebGPU renderer** for its model preview, and two renderers drawing in the
   * same animation frame make both of them destroy and rebuild their output
   * target every frame. It reports as hundreds of `Destroyed texture … used in
   * a submit` per second, on both renderers at once, and it costs a texture
   * allocation per renderer per frame. Measured: 111 errors in four seconds with
   * both drawing, none in five with only one.
   *
   * What this gives up is that the strip of scene visible through the dialog's
   * 50%-black backdrop holds still. For a scene it is indistinguishable; for one
   * with moving clouds it is a frozen frame in a nine-pixel margin.
   *
   * **Two conditions, and they are not the same condition.** The modal is the
   * intent — nothing to draw for. `rendererCount()` is the mechanism, and it is
   * what closes the edge the modal alone leaves open: the overlay comes off the
   * stack and the preview's renderer is disposed in the same React commit, in an
   * order this side does not get to choose. Asking how many renderers are
   * actually alive answers exactly the question, without guessing at frames.
   *
   * One error survives all of this: exactly one, on the first import dialog
   * closed in a session, on the viewport's own target. It is not this pause —
   * pausing and resuming the loop on its own emits nothing — but the teardown of
   * the second renderer. A frame of hysteresis before drawing again was tried
   * and measured, and changed nothing, so it is not here.
   */
  private shouldSkipRender(): boolean {
    return (
      rendererCount() > 1 ||
      useOverlayStore.getState().stack.some((overlay) => overlay.kind === 'modal')
    );
  }

  private tick(time: number): void {
    if (this.disposed) return;

    // First thing in the frame, so a destroy reported later can be attributed to
    // this frame's size or to no size change at all. No-op unless armed.
    probeFrame(this.renderer, this.container);

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

      // Simulation carries on; only the drawing stops. Pausing the game because
      // a dialog opened would be a different decision, and not one to take here.
      if (covered) return;
      this.renderer.render(engine.scene, engine.activeCamera);
      this.reportStats(time);
      return;
    }

    this.syncDocument();
    // `raw`, not the simulated delta: flying the editor camera is not part of
    // the simulation, and a timescale of zero must not nail it to the spot.
    this.controls.update(raw);
    this.syncSelection();
    // The ear rides the editor camera while nothing is running, which is what
    // makes an audition of a positional source worth anything: fly toward the
    // source and it gets louder. A no-op until something has actually been
    // previewed, because the preview builds its engine lazily.
    audioPreview.setListener(...cameraPose(this.camera));
    // Only while a handle is held: the gizmo moves the object directly and the
    // document catches up a frame later, so without this a batched object
    // lags the handle by a frame. Every other change comes through `sync`,
    // which refreshes the batches itself.
    if (this.gizmo.isEngaged) this.binder.updateBatches();
    if (covered) return;
    this.renderer.render(this.scene, this.camera);
    this.reportStats(time);
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
    // `isNavigating` only covers the fly gesture; `navigating` covers pan and
    // orbit too, and it is what keeps the handles away for the whole press.
    this.gizmo.setEnabled(!this.controls.isNavigating && !this.navigating);
    this.gizmo.update(current, resolve, bounds, transformMode);

    // `current.ids` rather than the store's: an id naming nothing has already
    // been dropped there, and a marker for it would sit at the origin forever.
    // The canvas height, not the container's — the canvas is what the projection
    // was built against, and the two differ for a frame after a dock resize.
    this.overlay.update(
      expandedScene().scene,
      current.ids,
      this.camera,
      this.canvas.clientHeight,
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
    this.canvas.addEventListener('pointerdown', (event) => {
      if (this.engine) return;

      // Right, middle and Alt+left move the camera. The gizmo has no business
      // with any of them, and letting it capture the pointer is what threw.
      this.navigating = event.button === 2 || event.button === 1 || (event.button === 0 && event.altKey);
      if (this.navigating) this.gizmo.setEnabled(false);

      // The other direction: a press that starts on a gizmo handle must not
      // also move the camera.
      this.controls.enabled = !this.gizmo.isEngaged;
      this.pointerDownAt = { x: event.clientX, y: event.clientY, button: event.button };
    });

    const endGesture = () => {
      this.navigating = false;
    };
    this.canvas.addEventListener('pointerup', endGesture);
    this.canvas.addEventListener('pointercancel', endGesture);
  }

  /**
   * Click-to-select. A click is a press and release that did not move far —
   * anything else is a camera drag, and the gizmo takes priority over both.
   */
  private installSelectionHandlers(): void {
    this.canvas.addEventListener('pointerup', (event) => {
      const down = this.pointerDownAt;
      this.pointerDownAt = null;
      // Clicking in the game view captures the mouse; it must not also select.
      if (this.engine) return;

      this.controls.enabled = true;

      if (!down || down.button !== 0 || event.button !== 0) return;
      if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) return;
      if (this.gizmo.isEngaged || event.altKey) return;

      const entityId = this.picker.pick(
        event.clientX,
        event.clientY,
        this.canvas.getBoundingClientRect(),
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
    });
  }

  private reportStats(time: number): void {
    this.framesSinceReport += 1;
    if (this.lastReportTime === 0) this.lastReportTime = time;

    const elapsed = time - this.lastReportTime;
    if (elapsed < STATS_INTERVAL_MS) return;

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

  private buildHelpers(): void {
    // Two tiers, like Unity: metre cells near the origin, ten-metre cells beyond.
    // Values are well above the background so the ground plane reads at a glance.
    const fine = new GridHelper(200, 200, 0x7d858e, 0x4d545b);
    const coarse = new GridHelper(2000, 200, 0x8a939d, 0x5a6269);
    coarse.position.y = -0.001; // Avoid z-fighting with the fine grid.

    for (const grid of [fine, coarse]) {
      const material = grid.material;
      material.transparent = true;
      material.opacity = 0.85;
      material.depthWrite = false;
      grid.renderOrder = -1;
      this.helpers.add(grid);
    }
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
  }

  private buildFallbackLighting(): void {
    const sky = new HemisphereLight(0xbfd4e8, 0x3a3428, 1.1);
    const sun = new DirectionalLight(0xffffff, 2.2);
    sun.position.set(12, 18, 8);
    this.fallbackLighting.add(sky, sun);
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
