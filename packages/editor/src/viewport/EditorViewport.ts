import {
  capabilitiesOf,
  createRenderingSettings,
  type ExpandedScene,
  type RenderingSettings,
  type SceneDoc,
} from '@three-studio/core';
import { FIXED_STEP, studioTime, type Engine, type SceneBinder } from '@three-studio/runtime';
import {
  PerspectiveCamera,
  Vector3,
  type Group,
  type Scene,
  type WebGPURenderer,
} from 'three/webgpu';
import {
  editorAssetResolver,
  useAssetStore,
} from '../state/assetStore';
import { audioPreview } from '../audio/preview';
import { useOverlayStore } from '../state/overlayStore';
import { timescaleFor } from './timescale';
import { useDocumentStore } from '../state/documentStore';
import { expandedScene } from '../state/expansion';
import { Selection } from '../state/selection';
import { useProjectStore } from '../state/projectStore';
import { useEditorStore } from '../state/editorStore';
import { useViewportStore } from '../state/viewportStore';
import { FlyControls } from './FlyControls';
import { GizmoController } from './GizmoController';
import { horizontalPlaneHit } from './dropPlane';
import { Picker } from './Picker';
import { createEditorProjection } from './editorProjection';
import type { Presentation } from './Presentation';
import { ViewportInput } from './ViewportInput';
import { PlaySession } from './PlaySession';
import { ViewportRenderer } from './ViewportRenderer';
import type { SelectionOutline } from './SelectionOutline';
import type { ViewportOverlay } from './overlay/ViewportOverlay';

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

  /**
   * The device, the off-screen surface, and the three panels showing corners of
   * it. Everything on screen goes through here; nothing else in the editor owns
   * a renderer, and `ViewportRenderer` says why.
   */
  private readonly view: ViewportRenderer;

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

  /** Who gets the pointer: the camera, the gizmo, or the selection. */
  private readonly input: ViewportInput;

  /** Play, Pause and Stop, and everything that has to happen around them. */
  private readonly play: PlaySession;

  private lastFrameTime = 0;
  private disposed = false;

  static async create(): Promise<EditorViewport> {
    /*
     * The project's own settings, so the viewport shows what a build will —
     * read once, here, and carried from here to everything this viewport
     * builds. Play mode reads the same object rather than the store again, so
     * pressing Play cannot pick up a different answer than the Scene view is
     * already showing. That is the whole of this task: one reading, one answer.
     */
    const rendering =
      useProjectStore.getState().project?.settings.rendering ?? createRenderingSettings();
    return new EditorViewport(await ViewportRenderer.create(rendering), rendering);
  }

  private constructor(
    view: ViewportRenderer,
    /**
     * The project's settings, read once by `create` and carried from here to
     * everything this viewport builds — the projection, and the running game
     * through `PlayHost`. Play reading the store again is how the two came
     * apart. Public because `PlayHost` names it.
     */
    readonly rendering: RenderingSettings,
  ) {
    this.view = view;

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
      // The one thing the binder cannot do without a device; see `EnvironmentBinder`.
      renderer: view.renderer,
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
    // arbitration actually arbitrates. Which is why it is handed `this` — the
    // fields it reads are filled in on the lines below. See `InputSubjects`.
    this.input = new ViewportInput(this.view.sceneView.canvas, this);

    this.controls = new FlyControls(this.camera, this.view.sceneView.canvas);
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
    this.gizmo = new GizmoController(this.camera, this.view.sceneView.canvas);
    // Into the group the projection reserved for it, because `TransformControls`
    // needs a canvas and the projection is built without one. The pivot goes in
    // too: `TransformControls` tracks the world matrix of what it is attached
    // to, and an object outside the graph never gets one.
    projection.transformGizmo.add(this.gizmo.helper, this.gizmo.pivotObject);

    // Last, after the camera's listeners and the gizmo's; see `InputSubjects`.
    this.input.installSelection();

    useViewportStore.getState().setBackend(view.backend);
    this.play = new PlaySession(this);
    this.play.watch();
    // Owning the loop is what earns the right to own the clock: this is where
    // three's `time` node stops reading `performance.now()` and starts reading
    // the simulation. Once per viewport, and the viewport is once per document.
    studioTime.install();
    void this.view.renderer.setAnimationLoop((time) => this.tick(time));
  }

  /** Show the Scene view in this panel. Safe to call repeatedly. */
  attachScene(host: HTMLElement): void {
    this.view.attach(this.view.sceneView, host);
  }

  detachScene(): void {
    this.view.detach(this.view.sceneView);
  }

  /** Show the running game in this panel. Safe to call repeatedly. */
  attachGame(host: HTMLElement): void {
    this.view.attach(this.view.gameView, host);
  }

  detachGame(): void {
    this.view.detach(this.view.gameView);
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
    this.view.attach(this.view.previewView, host);
    return this.view.previewView.canvas;
  }

  detachPreview(): void {
    this.preview = null;
    this.view.detach(this.view.previewView);
  }


  dispose(): void {
    this.disposed = true;
    this.input.dispose();
    this.play.dispose();
    this.controls.dispose();
    this.gizmo.dispose();
    this.outline.dispose();
    this.overlay.dispose();
    this.binder.dispose();
    // Last, and it takes the loop, the observer, the three panels' canvases and
    // the device with it.
    this.view.dispose();
  }

  /** True while the game is running; see `InputSubjects`. */
  get playing(): boolean {
    return this.play.playing;
  }

  /** The running game, or `null` when stopped. Read-only; use the transport. */
  get playEngine(): Engine | null {
    return this.play.playEngine;
  }

  /*
   * `PlayHost`. The renderer and the Game panel come from the one device this
   * document is allowed; the two announcements are the parts of the viewport a
   * running game touches and that a play session has no business holding.
   */

  get renderer(): WebGPURenderer {
    return this.view.renderer;
  }

  get gameView(): Presentation {
    return this.view.gameView;
  }

  onPlayStarted(): void {
    // Not because they would fight the game for the pointer — each view has its
    // own canvas now — but because the Scene view is a *view* while the game
    // runs: flying it or dragging a handle would edit a document that Stop is
    // about to put back the way it was.
    this.controls.setEnabled(false);
    this.gizmo.setEnabled(false);
    // The engine needs the viewport aspect; the frame loop hands it over on the
    // next tick rather than resizing the renderer from here.
    this.view.markResized();
  }

  onPlayStopped(): void {
    this.controls.setEnabled(true);
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
    const rect = this.view.sceneView.canvas.getBoundingClientRect();
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
    const rect = this.view.sceneView.canvas.getBoundingClientRect();
    return this.dropPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
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
    this.view.probe();

    // Before `beginFrame` and before either render, and *before* the covered
    // check: a viewport parked behind a modal still has to take the new size, or
    // it comes back holding a target built for a box that no longer exists.
    //
    // The surface is the renderer's to size; the cameras that answer to a panel
    // are not, so they are corrected here. Two of the three unconditionally,
    // and each for its own reason: the engine may have *arrived* since the last
    // resize — `beginPlay` raises the flag precisely so that it is handed the
    // shape of its panel, which has usually not moved a pixel — and selecting
    // another file in the import dialog swaps one preview camera for another
    // without its panel moving either, leaving a camera that has never heard a
    // box at the 1:1 aspect it was constructed with.
    if (this.view.resizePending) {
      const sceneMoved = this.view.applyResize();
      if (sceneMoved && this.view.sceneView.visible) {
        this.camera.aspect = this.view.sceneView.width / this.view.sceneView.height;
        this.camera.updateProjectionMatrix();
      }
      if (this.play.playEngine) this.play.syncAspect(this.play.playEngine);
      if (this.preview && this.view.previewView.visible) {
        const { camera } = this.preview;
        camera.aspect = this.view.previewView.width / this.view.previewView.height;
        camera.updateProjectionMatrix();
      }
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

    const engine = this.play.playEngine;
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
      if (this.view.sceneView.host) this.controls.update(raw);
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
    if (this.view.sceneView.visible) {
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
    if (preview && this.view.previewView.visible) {
      preview.onFrame();
      this.view.draw(preview.scene, preview.camera, this.view.previewView);
    }

    // Simulation carries on; only the drawing stops. Pausing the game because
    // a dialog opened would be a different decision, and not one to take here.
    if (covered) return;

    this.view.draw(this.scene, this.camera, this.view.sceneView);
    if (engine) this.view.draw(engine.scene, engine.activeCamera, this.view.gameView);
    this.view.reportStats(time, this.controls.moveSpeed);
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
    if (!this.playing) {
      this.gizmo.setEnabled(!this.controls.isNavigating && !this.input.navigating);
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
      this.view.sceneView.height,
      showGizmos,
    );

    // Keep the orbit pivot and the F shortcut on the selection.
    if (bounds) {
      bounds.getCenter(this.controls.pivot);
      this.controls.focusRadius = Math.max(bounds.getSize(SCRATCH_SIZE).length() * 0.5, 0.5);
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
    // ADR-0003 kept out of the frame loop. What runs per frame is only the placing.
    this.overlay.sync(scene, merged);
    if (changes.environment) this.binder.syncEnvironment(this.scene, scene);

    // A scene with no lights of its own would render black, which reads as a
    // bug rather than as "you have not added a light yet".
    //
    // Asked of the *expanded* scene, and that is the whole of it: a level whose
    // lights all come from prefab instances has none in the document, so the
    // fallback pair stayed on over the real ones and every such scene was lit
    // twice.
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
