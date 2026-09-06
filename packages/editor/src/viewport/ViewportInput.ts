import type { PerspectiveCamera } from 'three/webgpu';
import { useEditorStore } from '../state/editorStore';
import type { FlyControls } from './FlyControls';
import type { GizmoController } from './GizmoController';
import type { Picker } from './Picker';

/**
 * What a pointer event has to consult, read **at event time**.
 *
 * Not values, because none of them exists yet when this is built. The
 * arbitration listener has to be registered on the canvas before `FlyControls`
 * and `TransformControls` register theirs — listeners on one element run in
 * registration order, and that order is the whole of how the arbitration
 * arbitrates — so the viewport hands over an object whose fields it is still in
 * the middle of filling in. They are all set long before a pointer moves.
 */
export interface InputSubjects {
  readonly camera: PerspectiveCamera;
  readonly controls: FlyControls;
  readonly gizmo: GizmoController;
  readonly picker: Picker;
  /** True while the game is running, which changes what a click means. */
  readonly playing: boolean;
}

/**
 * Who gets the pointer: the camera, the gizmo, or the selection.
 *
 * Three parties want the same press and only one may have it, and the rules are
 * not symmetric — a press on a handle must not also fly the camera, a press
 * with Alt must not touch the handles, and a release has to unlatch both
 * wherever it lands. All of it used to sit in `EditorViewport` among six other
 * jobs.
 */
export class ViewportInput {
  /**
   * Removes every listener this puts on the canvas and the window.
   *
   * A signal rather than four stored handlers: the four below were installed as
   * anonymous closures and never removed, which is invisible while the canvas
   * is a singleton and a leak the moment it is not.
   */
  private readonly listeners = new AbortController();

  private pointerDownAt: { x: number; y: number; button: number } | null = null;

  /**
   * True from the press that starts a camera move until its release.
   *
   * The gizmo is switched off for the whole gesture, not just while
   * `isNavigating` is true: pan and orbit never set that flag, and the frame
   * loop would hand the handles back mid-drag. Read by the frame loop, which is
   * why it is public where the press position is not.
   */
  navigating = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly subjects: InputSubjects,
  ) {
    this.installPointerArbitration();
  }

  /**
   * Click-to-select, installed after the camera and the gizmo have theirs.
   *
   * Separate from the constructor for the same reason the arbitration is in it:
   * registration order is the arbitration, and this one has to come last.
   */
  installSelection(): void {
    this.installSelectionHandlers();
  }

  dispose(): void {
    this.listeners.abort();
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

    this.canvas.addEventListener(
      'pointerdown',
      (event) => {
        if (this.subjects.playing) return;

        // Right, middle and Alt+left move the camera. The gizmo has no business
        // with any of them, and letting it capture the pointer is what threw.
        this.navigating =
          event.button === 2 || event.button === 1 || (event.button === 0 && event.altKey);
        if (this.navigating) this.subjects.gizmo.setEnabled(false);

        // The other direction: a press that starts on a gizmo handle must not
        // also move the camera.
        this.subjects.controls.setEnabled(!this.subjects.gizmo.isEngaged);
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
      if (!this.subjects.playing) this.subjects.controls.setEnabled(true);
    };
    window.addEventListener('pointerup', endGesture, { signal });
    window.addEventListener('pointercancel', endGesture, { signal });
    this.canvas.addEventListener('lostpointercapture', endGesture, { signal });
  }

  /**
   * Click-to-select. A click is a press and release that did not move far —
   * anything else is a camera drag, and the gizmo takes priority over both.
   */
  private installSelectionHandlers(): void {
    this.canvas.addEventListener(
      'pointerup',
      (event) => {
        const down = this.pointerDownAt;
        this.pointerDownAt = null;
        // Clicking in the game view captures the mouse; it must not also select.
        if (this.subjects.playing) return;

        if (!down || down.button !== 0 || event.button !== 0) return;
        if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) return;
        if (this.subjects.gizmo.isEngaged || event.altKey) return;

        const entityId = this.subjects.picker.pick(
          event.clientX,
          event.clientY,
          this.canvas.getBoundingClientRect(),
          this.subjects.camera,
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
}
