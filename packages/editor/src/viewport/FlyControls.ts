import { Euler, MathUtils, PerspectiveCamera, Spherical, Vector3 } from 'three/webgpu';

/** `KeyboardEvent.code` values, so the bindings survive AZERTY and QWERTZ. */
const FORWARD_KEYS = ['KeyW', 'ArrowUp'];
const BACK_KEYS = ['KeyS', 'ArrowDown'];
const LEFT_KEYS = ['KeyA', 'ArrowLeft'];
const RIGHT_KEYS = ['KeyD', 'ArrowRight'];
const DOWN_KEYS = ['KeyQ'];
const UP_KEYS = ['KeyE'];

const MIN_SPEED = 0.25;
const MAX_SPEED = 400;
const HALF_PI = Math.PI / 2;

type Mode = 'idle' | 'look' | 'pan' | 'orbit';

/**
 * Editor camera navigation, modelled on Unity's scene view.
 *
 * three's own `FirstPersonControls` grabs the pointer unconditionally and has
 * no right-button gate, which makes it unusable in an editor where the same
 * surface must also handle selection and gizmo dragging.
 *
 * | Input                  | Action                                      |
 * | ---------------------- | ------------------------------------------- |
 * | Right button held      | Mouse look, WASD to fly, Q/E down/up        |
 * | Shift (while looking)  | Speed boost                                 |
 * | Wheel (while looking)  | Adjust fly speed                            |
 * | Wheel (otherwise)      | Dolly towards the cursor direction          |
 * | Middle button drag     | Pan                                         |
 * | Alt + left button drag | Orbit around the pivot                      |
 * | F                      | Frame the pivot                             |
 */
export class FlyControls {
  enabled = true;

  /** Metres per second. Persisted across sessions by the caller if desired. */
  moveSpeed = 10;
  boostMultiplier = 4;
  lookSensitivity = 0.0022;
  panSensitivity = 0.0018;
  orbitSensitivity = 0.006;
  dollySensitivity = 0.0012;

  /** What Alt-orbit rotates around and what F frames. */
  readonly pivot = new Vector3();
  /** Bounding radius used by the F shortcut; selection updates it in M4. */
  focusRadius = 5;

  private readonly camera: PerspectiveCamera;
  private readonly dom: HTMLElement;
  private readonly pressed = new Set<string>();

  private mode: Mode = 'idle';
  private pointerId: number | null = null;
  private pointerInside = false;
  private yaw = 0;
  private pitch = 0;

  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private readonly offset = new Vector3();
  private readonly spherical = new Spherical();
  private readonly euler = new Euler(0, 0, 0, 'YXZ');

  constructor(camera: PerspectiveCamera, dom: HTMLElement) {
    this.camera = camera;
    this.dom = dom;

    this.euler.setFromQuaternion(camera.quaternion);
    this.yaw = this.euler.y;
    this.pitch = this.euler.x;

    dom.addEventListener('contextmenu', this.onContextMenu);
    dom.addEventListener('pointerdown', this.onPointerDown);
    dom.addEventListener('pointermove', this.onPointerMove);
    dom.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('pointercancel', this.onPointerUp);
    dom.addEventListener('pointerenter', this.onPointerEnter);
    dom.addEventListener('pointerleave', this.onPointerLeave);
    dom.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
  }

  dispose(): void {
    this.dom.removeEventListener('contextmenu', this.onContextMenu);
    this.dom.removeEventListener('pointerdown', this.onPointerDown);
    this.dom.removeEventListener('pointermove', this.onPointerMove);
    this.dom.removeEventListener('pointerup', this.onPointerUp);
    this.dom.removeEventListener('pointercancel', this.onPointerUp);
    this.dom.removeEventListener('pointerenter', this.onPointerEnter);
    this.dom.removeEventListener('pointerleave', this.onPointerLeave);
    this.dom.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.endInteraction();
  }

  /** True while the right button is held, which is when WASD is live. */
  get isNavigating(): boolean {
    return this.mode === 'look';
  }

  /** Advance the fly movement. Call once per frame with the frame delta. */
  update(delta: number): void {
    if (!this.enabled || this.mode !== 'look') return;

    const boost = this.pressed.has('ShiftLeft') || this.pressed.has('ShiftRight');
    const distance = this.moveSpeed * (boost ? this.boostMultiplier : 1) * delta;
    if (distance === 0) return;

    this.camera.getWorldDirection(this.forward);
    this.right.crossVectors(this.forward, this.up).normalize();

    const move = this.offset.set(0, 0, 0);
    if (anyPressed(this.pressed, FORWARD_KEYS)) move.addScaledVector(this.forward, 1);
    if (anyPressed(this.pressed, BACK_KEYS)) move.addScaledVector(this.forward, -1);
    if (anyPressed(this.pressed, RIGHT_KEYS)) move.addScaledVector(this.right, 1);
    if (anyPressed(this.pressed, LEFT_KEYS)) move.addScaledVector(this.right, -1);
    if (anyPressed(this.pressed, UP_KEYS)) move.addScaledVector(this.up, 1);
    if (anyPressed(this.pressed, DOWN_KEYS)) move.addScaledVector(this.up, -1);

    if (move.lengthSq() === 0) return;
    move.normalize().multiplyScalar(distance);
    this.camera.position.add(move);
    this.pivot.add(move);
  }

  /** Move the camera back so a sphere of `radius` at `target` fills the view. */
  frame(target: Vector3, radius: number): void {
    const safeRadius = Math.max(radius, 0.25);
    const halfFov = MathUtils.degToRad(this.camera.fov * 0.5);
    const distance = (safeRadius / Math.tan(halfFov)) * 1.4;

    this.pivot.copy(target);
    this.camera.getWorldDirection(this.forward);
    this.camera.position.copy(target).addScaledVector(this.forward, -distance);
  }

  private applyLook(): void {
    this.pitch = MathUtils.clamp(this.pitch, -HALF_PI + 0.001, HALF_PI - 0.001);
    this.euler.set(this.pitch, this.yaw, 0);
    this.camera.quaternion.setFromEuler(this.euler);
  }

  /** Pan and dolly scale with distance so they feel the same at any zoom. */
  private get pivotDistance(): number {
    return Math.max(this.camera.position.distanceTo(this.pivot), 1);
  }

  private readonly onContextMenu = (event: MouseEvent) => event.preventDefault();

  private readonly onPointerEnter = () => {
    this.pointerInside = true;
  };

  private readonly onPointerLeave = () => {
    this.pointerInside = false;
    this.pressed.clear();
  };

  private readonly onPointerDown = (event: PointerEvent) => {
    if (!this.enabled || this.mode !== 'idle') return;

    if (event.button === 2) this.mode = 'look';
    else if (event.button === 1) this.mode = 'pan';
    else if (event.button === 0 && event.altKey) this.mode = 'orbit';
    else return;

    event.preventDefault();
    this.pointerId = event.pointerId;
    this.dom.setPointerCapture(event.pointerId);
    // Focus so the viewport, not whatever was clicked last, receives key events.
    this.dom.focus({ preventScroll: true });

    if (this.mode === 'look') {
      // Flying needs unbounded mouse travel, so the cursor is locked rather than
      // merely captured. The request rejects if the pointer was unlocked moments
      // ago (browser rate limit); look then falls back to captured movement.
      void Promise.resolve(this.dom.requestPointerLock()).catch(() => undefined);
    }
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    if (this.mode === 'idle' || event.pointerId !== this.pointerId) return;

    const dx = event.movementX;
    const dy = event.movementY;
    if (dx === 0 && dy === 0) return;

    if (this.mode === 'look') {
      this.yaw -= dx * this.lookSensitivity;
      this.pitch -= dy * this.lookSensitivity;
      this.applyLook();
      return;
    }

    if (this.mode === 'pan') {
      const factor = this.pivotDistance * this.panSensitivity;
      this.camera.getWorldDirection(this.forward);
      this.right.crossVectors(this.forward, this.up).normalize();
      const cameraUp = this.offset.crossVectors(this.right, this.forward).normalize();

      this.camera.position.addScaledVector(this.right, -dx * factor);
      this.camera.position.addScaledVector(cameraUp, dy * factor);
      this.pivot.addScaledVector(this.right, -dx * factor);
      this.pivot.addScaledVector(cameraUp, dy * factor);
      return;
    }

    // Orbit: rotate the camera position around the pivot, then look back at it.
    this.offset.copy(this.camera.position).sub(this.pivot);
    this.spherical.setFromVector3(this.offset);
    this.spherical.theta -= dx * this.orbitSensitivity;
    this.spherical.phi = MathUtils.clamp(
      this.spherical.phi - dy * this.orbitSensitivity,
      0.001,
      Math.PI - 0.001,
    );
    this.camera.position.copy(this.pivot).add(this.offset.setFromSpherical(this.spherical));
    this.camera.lookAt(this.pivot);
    this.euler.setFromQuaternion(this.camera.quaternion);
    this.yaw = this.euler.y;
    this.pitch = this.euler.x;
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerId) return;
    this.endInteraction();
  };

  private readonly onWheel = (event: WheelEvent) => {
    if (!this.enabled || !this.pointerInside) return;
    event.preventDefault();

    if (this.mode === 'look') {
      // Unity adjusts fly speed with the wheel while navigating; a multiplicative
      // step keeps the control usable across three orders of magnitude.
      const factor = Math.exp(-event.deltaY * 0.0015);
      this.moveSpeed = MathUtils.clamp(this.moveSpeed * factor, MIN_SPEED, MAX_SPEED);
      return;
    }

    const step = -event.deltaY * this.pivotDistance * this.dollySensitivity;
    this.camera.getWorldDirection(this.forward);
    this.camera.position.addScaledVector(this.forward, step);
  };

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (!this.enabled || !this.pointerInside) return;
    if (isTypingTarget(event.target)) return;

    this.pressed.add(event.code);

    if (event.code === 'KeyF' && this.mode === 'idle') {
      // Until a selection exists (M4) the pivot is the only focus target, so F
      // recentres the view on it.
      event.preventDefault();
      this.frame(this.pivot, this.focusRadius);
      return;
    }

    // Movement keys must not scroll or trigger browser shortcuts while flying.
    if (this.mode === 'look') event.preventDefault();
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    this.pressed.delete(event.code);
  };

  /** Losing the window with keys held would otherwise leave the camera drifting. */
  private readonly onBlur = () => {
    this.pressed.clear();
    this.endInteraction();
  };

  /** Escape releases the lock without a pointerup, so stop navigating too. */
  private readonly onPointerLockChange = () => {
    if (this.mode === 'look' && document.pointerLockElement !== this.dom) {
      this.endInteraction();
    }
  };

  private endInteraction(): void {
    if (this.pointerId !== null && this.dom.hasPointerCapture(this.pointerId)) {
      this.dom.releasePointerCapture(this.pointerId);
    }
    if (document.pointerLockElement === this.dom) document.exitPointerLock();
    this.pointerId = null;
    this.mode = 'idle';
  }
}

function anyPressed(pressed: ReadonlySet<string>, codes: readonly string[]): boolean {
  return codes.some((code) => pressed.has(code));
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  );
}
