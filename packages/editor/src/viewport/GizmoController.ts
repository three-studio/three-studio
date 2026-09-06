import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { Box3, Matrix4, Object3D, Quaternion, Vector3, type Camera } from 'three/webgpu';
import { transformSelection } from '../commands/sceneCommands';
import type { Selection } from '../state/selection';
import {
  useEditorStore,
  type PivotMode,
  type TransformMode,
  type TransformSpace,
} from '../state/editorStore';

const TRANSLATE_SNAP = 0.5;
const ROTATE_SNAP = Math.PI / 12; // 15 degrees
const SCALE_SNAP = 0.1;

/**
 * Where the gizmo's pivot sits, and which way its handles point.
 *
 * A function rather than three lines inside `update` because it is the whole of
 * what a reader has to get right, and because it is the only part of this file
 * that can be tested: `new TransformControls(camera, dom)` wants an
 * `HTMLElement`, and there is no DOM under vitest.
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

  // The centre of a group is still turned about the active object's axes, as
  // in Unity: the group has no orientation of its own to offer.
  const oriented = mode === 'scale' || space === 'local';
  const quaternion =
    oriented && primary !== undefined
      ? primary.getWorldQuaternion(new Quaternion())
      : new Quaternion();

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
  /** What the gizmo is actually attached to. Never in the document. */
  private readonly pivot = new Object3D();
  /** The pivot's pose at the last push, so a change becomes a delta. */
  private readonly previous = new Matrix4();
  private targets: Selection | null = null;
  private dragGeneration = 0;
  private snapEnabled = false;
  private attached = false;

  constructor(camera: Camera, dom: HTMLElement) {
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

  /** True while the pointer is on a handle, so picking must stand down. */
  get isEngaged(): boolean {
    return this.controls.dragging || this.controls.axis !== null;
  }

  setEnabled(enabled: boolean): void {
    this.controls.enabled = enabled;
    this.helper.visible = enabled && this.attached;
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
      this.helper.visible = false;
      return;
    }

    this.targets = selection;

    const { transformSpace, pivotMode, snapEnabled } = useEditorStore.getState();
    // Rotation follows the Global/Local button, as in Unity. Scale never does —
    // see `pivotPose`, which is where that is argued.
    const space = mode === 'scale' ? 'local' : transformSpace;

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

    this.helper.visible = true;

    // `update` runs every frame, and each of these setters fires a change event
    // that makes TransformControls rebuild its gizmo. Only touch what moved.
    if (this.controls.mode !== mode) this.controls.setMode(mode);
    if (this.controls.space !== space) this.controls.setSpace(space);
    if (this.snapEnabled !== snapEnabled) {
      this.snapEnabled = snapEnabled;
      this.controls.setTranslationSnap(snapEnabled ? TRANSLATE_SNAP : null);
      this.controls.setRotationSnap(snapEnabled ? ROTATE_SNAP : null);
      this.controls.setScaleSnap(snapEnabled ? SCALE_SNAP : null);
    }
  }

  dispose(): void {
    this.controls.detach();
    this.controls.dispose();
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
