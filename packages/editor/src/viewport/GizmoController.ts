import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { Box3, Matrix4, Object3D, Vector3, type Camera } from 'three/webgpu';
import { transformSelection } from '../commands/sceneCommands';
import type { Selection } from '../state/selection';
import { useEditorStore, type TransformMode } from '../state/editorStore';

const TRANSLATE_SNAP = 0.5;
const ROTATE_SNAP = Math.PI / 12; // 15 degrees
const SCALE_SNAP = 0.1;

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

    // Not while dragging: the pivot is being driven, and re-placing it under the
    // pointer would fight the gesture.
    if (!this.controls.dragging) {
      const { pivotMode } = useEditorStore.getState();
      const primary = selection.primary;
      const anchor =
        pivotMode === 'center' && bounds !== null
          ? bounds.getCenter(new Vector3())
          : (primary === null ? undefined : resolve(primary)?.getWorldPosition(new Vector3()));

      this.pivot.position.copy(anchor ?? new Vector3());
      this.pivot.rotation.set(0, 0, 0);
      this.pivot.scale.set(1, 1, 1);
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
    const { transformSpace, snapEnabled } = useEditorStore.getState();
    // Rotation and scale are always local; only translation honours the space
    // toggle, which is how Unity and Blender behave.
    const space = mode === 'translate' ? transformSpace : 'local';

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
