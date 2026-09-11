import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { Box3, Matrix4, Object3D, Quaternion, Vector3, type PerspectiveCamera } from 'three/webgpu';
import { transformSelection } from '../commands/sceneCommands';
import { gestureAxis, gizmoUnit, RotationReadout } from './RotationReadout';
import type { Selection } from '../state/selection';
import {
  useEditorStore,
  type PivotMode,
  type TransformMode,
  type TransformSpace,
} from '../state/editorStore';

/**
 * What `TransformControls` publishes at runtime that `@types/three` leaves out.
 *
 * None of these is private. Three defines them with the very same
 * `defineProperty` helper as `axis` and `dragging`, and mirrors each one onto
 * its own gizmo and plane — which is how those two draw anything at all. Only
 * the type declarations stop at the handful a caller was expected to want.
 *
 * One cast, in one place, so the day the declarations catch up there is a
 * single line to delete rather than five scattered ones.
 */
interface RotationGestureSource {
  readonly rotationAxis: Vector3;
  readonly rotationAngle: number;
  readonly pointStart: Vector3;
  readonly worldPositionStart: Vector3;
  readonly worldQuaternionStart: Quaternion;
}

const TRANSLATE_SNAP = 0.5;
const ROTATE_SNAP = Math.PI / 12; // 15 degrees
const SCALE_SNAP = 0.1;

/**
 * Where the gizmo's pivot sits, and which way its handles point.
 *
 * A function rather than three lines inside `update` because it is the whole of
 * what a reader has to get right.
 *
 * It used to say it was also the only part of this file that could be tested,
 * because `new TransformControls(camera, dom)` wanted an `HTMLElement`. That is
 * no longer true and was never quite the obstacle: three's `Controls` takes
 * `domElement = null` and only listens when it is given one. What wants a DOM
 * is `RotationReadout`, which asks for a canvas in its constructor — and
 * `test/gizmoVisibility.test.ts` stands one in and drives the whole controller.
 *
 * The orientation is the half that was missing entirely. `TransformControls`
 * points its handles with the world quaternion of whatever it is attached to
 * (`TransformControls.js:1587`), and it is attached to the pivot — which was
 * reset to identity on every frame that was not a drag. Three things followed
 * from that one omission:
 *
 *  - a rotation gizmo turned with the gesture and snapped back to the world
 *    axes the instant the pointer came up, which is what got this looked at;
 *  - the Global/Local button did nothing at all, in any mode, because both of
 *    its branches read the same identity;
 *  - scaling a rotated object along one axis scaled it along a *world* axis.
 *    On the axes that still line up that is merely the wrong axis; off them it
 *    leaves shear in the matrix, and position/rotation/scale has nowhere to put
 *    shear — `Matrix4.decompose` drops it without a word.
 *
 * Scale is oriented to the object whatever the button says. That is not a
 * preference — three forces `space = 'local'` for scale internally
 * (`TransformControls.js:1585`), and the paragraph above is what the other
 * answer means. Unity draws the same line.
 *
 * `parent` came later and is the cheapest of the three, because the scene graph
 * already answers it: a root entity hangs from `SceneBinder.root`, a `Group`
 * that is never given a transform, so reading the parent's world quaternion
 * yields the identity there — Global, without a branch saying so.
 */
export function pivotPose(options: {
  mode: TransformMode;
  space: TransformSpace;
  pivotMode: PivotMode;
  /** World bounds of the selection, or `null` when it has none. */
  bounds: Box3 | null;
  /** The active object — the one the handles orient to. */
  primary: Object3D | undefined;
}): { position: Vector3; quaternion: Quaternion } {
  const { mode, space, pivotMode, bounds, primary } = options;

  const position =
    pivotMode === 'center' && bounds !== null
      ? bounds.getCenter(new Vector3())
      : (primary?.getWorldPosition(new Vector3()) ?? new Vector3());

  // Which object lends its axes — and `undefined` for Global, which lends the
  // world's. The centre of a group is still turned about the active object's
  // axes, as in Unity: the group has no orientation of its own to offer.
  const frame =
    mode === 'scale' || space === 'local'
      ? primary
      : space === 'parent'
        ? (primary?.parent ?? undefined)
        : undefined;

  const quaternion = frame?.getWorldQuaternion(new Quaternion()) ?? new Quaternion();

  return { position, quaternion };
}

/**
 * Wires three's `TransformControls` to the scene document.
 *
 * It drives a **synthetic pivot**, not the selected object. The gizmo moves that
 * pivot; the difference between where the pivot was and where it is becomes a
 * world-space delta, and every target's new pose is computed from it.
 *
 * That is a change of nature rather than an extension, and it is what makes the
 * multi-object case work at all. Attached to one bound object, the gizmo had
 * nothing to say about the other twenty-nine — and rotation would have been three
 * Euler angles added to each object's own, turning each around its own origin
 * instead of around the group. Unity and Blender both turn the group.
 *
 * The single-object case goes through the same path. One code path that handles
 * one object is worth more than two that disagree at the edges.
 */
export class GizmoController {
  private readonly controls: TransformControls;
  private readonly camera: PerspectiveCamera;
  /** The swept sector and the angle, which three draws neither of. */
  private readonly readout = new RotationReadout();
  /** Reused so a frame of dragging allocates nothing. */
  private readonly cameraPosition = new Vector3();
  /** What the gizmo is actually attached to. Never in the document. */
  private readonly pivot = new Object3D();
  /** The pivot's pose at the last push, so a change becomes a delta. */
  private readonly previous = new Matrix4();
  private targets: Selection | null = null;
  private dragGeneration = 0;
  private snapEnabled = false;
  private attached = false;

  constructor(camera: PerspectiveCamera, dom: HTMLElement) {
    this.camera = camera;
    this.controls = new TransformControls(camera, dom);
    this.controls.size = 0.85;
    this.pivot.matrixAutoUpdate = true;

    this.controls.addEventListener('objectChange', () => this.pushDelta());
    this.controls.addEventListener('dragging-changed', (event) => {
      // A new generation on release means the next drag opens a fresh undo
      // entry instead of merging into the previous one.
      if (event.value === false) this.dragGeneration += 1;
    });
  }

  /** The renderable part; `TransformControls` itself is not an `Object3D` in r185. */
  get helper(): Object3D {
    return this.controls.getHelper();
  }

  /** The pivot has to be in the scene graph for the gizmo to track it. */
  get pivotObject(): Object3D {
    return this.pivot;
  }

  /** The rotation readout, for the viewport to hang beside the handles. */
  get readoutObject(): Object3D {
    return this.readout.root;
  }

  /** True while the pointer is on a handle, so picking must stand down. */
  get isEngaged(): boolean {
    return this.controls.dragging || this.controls.axis !== null;
  }

  /**
   * Whether the handles take the pointer — and, the same question, whether they
   * are drawn at all.
   *
   * Two consequences of one flag, and they have to stay one flag. The rule is
   * the viewport's own, written where Play switches them off: handles that
   * cannot be dragged must not be drawn either. A handle that is drawn and does
   * not answer can only be found out by trying to drag it, and by then the
   * camera has moved instead.
   *
   * (Unity and Blender keep theirs on screen through a camera move. This editor
   * does not, deliberately: it is the signal that the pointer now belongs to
   * the camera.)
   */
  setEnabled(enabled: boolean): void {
    this.controls.enabled = enabled;
    this.showHelper();
  }

  /**
   * The one place that decides whether the handles are on screen.
   *
   * It used to be two, and they disagreed. `setEnabled` hid them; `update` ran
   * on the very next frame — and every frame after — and ended by showing them
   * again unconditionally, so the gizmo stayed drawn right through a camera
   * gesture it would refuse to answer. `ViewportInput` and `EditorViewport` both
   * call `setEnabled(false)` for exactly that gesture, and neither had any
   * effect on what was drawn.
   *
   * Play escaped it only by accident of ordering: `EditorViewport` skips
   * `update` entirely while the game runs, and the comment there says why in as
   * many words — "Leaving `update` to run would draw them: it ends by showing
   * the helper."
   */
  private showHelper(): void {
    this.helper.visible = this.attached && this.controls.enabled;
  }

  /**
   * Places the pivot on the selection and points the gizmo at it.
   *
   * @param bounds World bounds of the selection, or `null` when it has none —
   *   the outline has already measured them this frame.
   */
  update(
    selection: Selection,
    resolve: (id: string) => Object3D | undefined,
    bounds: Box3 | null,
    mode: TransformMode,
  ): void {
    const movable = selection.transformable();
    // The same rule that greys the menu entry, rather than a condition written
    // again here: a selection with one locked member cannot be moved at all.
    if (movable.length === 0 || mode === 'select' || !selection.can('translate')) {
      if (this.attached) {
        this.controls.detach();
        this.attached = false;
      }
      this.targets = null;
      this.showHelper();
      this.readout.hide();
      return;
    }

    this.targets = selection;

    const { transformSpace, pivotMode, snapEnabled } = useEditorStore.getState();
    // Rotation follows the handle-space button, as in Unity. Scale never does —
    // see `pivotPose`, which is where that is argued.
    const space = mode === 'scale' ? 'local' : transformSpace;

    /*
     * `TransformControls` knows two spaces, and two are enough for our three.
     *
     * The gizmo drives a synthetic pivot, and **the pivot is the frame**:
     * whatever quaternion `pivotPose` put on it, saying `'local'` to three
     * points the handles along the pivot's own axes and turns about them. So
     * Local and Parent are the same instruction to three and differ only in
     * what the pivot was given. Global is the one that asks for something the
     * pivot cannot carry — the world's axes whatever the pivot's — and that is
     * exactly what `'world'` means to three.
     */
    const controlsSpace = space === 'world' ? 'world' : 'local';

    // Not while dragging: the pivot is being driven, and re-placing it under the
    // pointer would fight the gesture.
    if (!this.controls.dragging) {
      const primary = selection.primary;
      const pose = pivotPose({
        mode,
        space,
        pivotMode,
        bounds,
        primary: primary === null ? undefined : resolve(primary),
      });

      this.pivot.position.copy(pose.position);
      this.pivot.quaternion.copy(pose.quaternion);
      this.pivot.scale.set(1, 1, 1);
      // The base the delta is measured from, so it has to be read *after* the
      // pose is on the pivot. A turned base cancels itself out of
      // `now × before⁻¹`, which is why giving the pivot an orientation changes
      // what the handles look like and nothing about what a drag produces.
      this.pivot.updateMatrixWorld(true);
      this.previous.copy(this.pivot.matrixWorld);
    }

    if (!this.attached) {
      this.controls.attach(this.pivot);
      this.attached = true;
    }

    this.showHelper();

    // `update` runs every frame, and each of these setters fires a change event
    // that makes TransformControls rebuild its gizmo. Only touch what moved.
    if (this.controls.mode !== mode) this.controls.setMode(mode);
    if (this.controls.space !== controlsSpace) this.controls.setSpace(controlsSpace);
    if (this.snapEnabled !== snapEnabled) {
      this.snapEnabled = snapEnabled;
      this.controls.setTranslationSnap(snapEnabled ? TRANSLATE_SNAP : null);
      this.controls.setRotationSnap(snapEnabled ? ROTATE_SNAP : null);
      this.controls.setScaleSnap(snapEnabled ? SCALE_SNAP : null);
    }

    this.updateReadout(mode);
  }

  dispose(): void {
    this.readout.dispose();
    this.controls.detach();
    this.controls.dispose();
  }

  /**
   * Describes the rotation in progress, or takes the description away.
   *
   * Only during a rotate drag. Outside one there is no gesture to draw, and
   * `rotationAngle` still holds whatever the last one ended on — so the test
   * has to be `dragging`, not "is the angle non-zero".
   */
  private updateReadout(mode: TransformMode): void {
    const { axis, dragging, enabled, size, space } = this.controls;
    const source = this.controls as unknown as RotationGestureSource;

    // `enabled` because the readout belongs to the handles: a press that starts
    // a camera gesture mid-drag takes them away, and a sector left hanging where
    // a gizmo used to be is worse than no feedback at all.
    //
    // A gesture that has not swept anything yet is the other case: a zero-width
    // sector is a stray line across the ring, and the number would sit at 0° for
    // as long as the pointer rests on the handle without moving.
    if (!enabled || mode !== 'rotate' || !dragging || axis === null || source.rotationAngle === 0) {
      this.readout.hide();
      return;
    }

    this.camera.getWorldPosition(this.cameraPosition);

    this.readout.show({
      centre: source.worldPositionStart,
      // `space` is three's, not ours: Local and Parent are both `'local'` to it,
      // and both leave the axis in the pivot's frame. See `gestureAxis`.
      axis: gestureAxis({
        handle: axis,
        space,
        rotationAxis: source.rotationAxis,
        frame: source.worldQuaternionStart,
      }),
      grab: source.pointStart,
      angle: source.rotationAngle,
      handle: axis,
      unit: gizmoUnit({
        distance: this.cameraPosition.distanceTo(source.worldPositionStart),
        fovDegrees: this.camera.fov,
        zoom: this.camera.zoom,
        size,
      }),
    });
  }

  /**
   * Turns the pivot's movement into a document edit.
   *
   * The delta is `now × before⁻¹` in world space, so it carries the rotation and
   * the scale about the pivot rather than about anything's own origin. `previous`
   * advances every push, which keeps each frame's edit relative to the last one
   * and the whole gesture in one undo entry.
   */
  private pushDelta(): void {
    const selection = this.targets;
    if (selection === null) return;

    this.pivot.updateMatrixWorld(true);
    const delta = this.pivot.matrixWorld.clone().multiply(this.previous.clone().invert());
    this.previous.copy(this.pivot.matrixWorld);

    transformSelection(selection, delta, {
      coalesceKey: `gizmo:${this.dragGeneration}`,
    });
  }
}
