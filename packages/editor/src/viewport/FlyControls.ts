import { PressedKeys } from '@three-studio/runtime';
import { Euler, MathUtils, PerspectiveCamera, Spherical, Vector3 } from 'three/webgpu';
import { hasModifier, isTypingTarget } from '../platform';

/** `KeyboardEvent.code` values, so the bindings survive AZERTY and QWERTZ. */
const FORWARD_KEYS = ['KeyW', 'ArrowUp'];
const BACK_KEYS = ['KeyS', 'ArrowDown'];
const LEFT_KEYS = ['KeyA', 'ArrowLeft'];
const RIGHT_KEYS = ['KeyD', 'ArrowRight'];
const DOWN_KEYS = ['KeyQ'];
const UP_KEYS = ['KeyE'];
const BOOST_KEYS = ['ShiftLeft', 'ShiftRight'];

const MIN_SPEED = 0.25;
const MAX_SPEED = 400;
const HALF_PI = Math.PI / 2;

type Mode = 'idle' | 'look' | 'pan' | 'orbit';

/** What `flyAxes` reads, so the decision can be taken without a keyboard. */
export interface KeyQuery {
  anyDown(codes: readonly string[]): boolean;
}

/** One step per axis, in camera space: forward/right/up, each −1, 0 or 1. */
export interface FlyAxes {
  forward: number;
  right: number;
  up: number;
}

/**
 * Which way the held keys ask the camera to go.
 *
 * Opposite keys cancel rather than one winning, so a key that is somehow still
 * held cannot silently reverse its partner — it stops the axis instead, which
 * is the failure the user can see and report.
 */
export function flyAxes(keys: KeyQuery): FlyAxes {
  return {
    forward: axis(keys, FORWARD_KEYS, BACK_KEYS),
    right: axis(keys, RIGHT_KEYS, LEFT_KEYS),
    up: axis(keys, UP_KEYS, DOWN_KEYS),
  };
}

function axis(keys: KeyQuery, positive: readonly string[], negative: readonly string[]): number {
  return (keys.anyDown(positive) ? 1 : 0) - (keys.anyDown(negative) ? 1 : 0);
}

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
 *
 * The viewport is a singleton that outlives every panel, so nothing here may
 * depend on being rebuilt to recover: `mode` has a single writer, and it drops
 * the held keys and the pointer on the way out of every gesture.
 */
export class FlyControls {
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
  private readonly keys = new PressedKeys();

  private active = true;
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
    document.addEventListener('visibilitychange', this.onVisibilityChange);
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
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.setMode('idle');
    this.releasePointer();
    this.keys.clear();
  }

  get enabled(): boolean {
    return this.active;
  }

  /**
   * Turning the camera off ends the gesture rather than freezing it.
   *
   * Play and the gizmo both switch it off mid-press. Leaving `mode` and the
   * held keys as they were meant the camera resumed a gesture the user had
   * long finished, the first time anything switched it back on.
   */
  setEnabled(value: boolean): void {
    if (this.active === value) return;
    this.active = value;
    if (!value) this.setMode('idle');
  }

  /** True while the right button is held, which is when WASD is live. */
  get isNavigating(): boolean {
    return this.mode === 'look';
  }

  /** Advance the fly movement. Call once per frame with the frame delta. */
  update(delta: number): void {
    if (!this.active || this.mode !== 'look') return;

    const boost = this.keys.anyDown(BOOST_KEYS);
    const distance = this.moveSpeed * (boost ? this.boostMultiplier : 1) * delta;
    if (distance === 0) return;

    const axes = flyAxes(this.keys);
    if (axes.forward === 0 && axes.right === 0 && axes.up === 0) return;

    this.camera.getWorldDirection(this.forward);
    this.right.crossVectors(this.forward, this.up).normalize();

    const move = this.offset
      .set(0, 0, 0)
      .addScaledVector(this.forward, axes.forward)
      .addScaledVector(this.right, axes.right)
      .addScaledVector(this.up, axes.up);

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

  /**
   * The only writer of `mode`, and the only reason the camera can be trusted
   * after a gesture the browser ended without telling us.
   *
   * A held key belongs to the gesture it was pressed in, so every transition
   * drops them all. `keyup` is not a guarantee — macOS withholds it for the
   * whole time Cmd is down, and a lost pointer lock takes the rest of the
   * gesture with it — and this is what keeps a missed one from outliving the
   * gesture and flying the camera on its own.
   */
  private setMode(next: Mode): void {
    if (this.mode === next) return;
    this.mode = next;
    this.keys.clear();
    if (next === 'idle') this.releasePointer();
  }

  private releasePointer(): void {
    if (this.pointerId !== null && this.dom.hasPointerCapture(this.pointerId)) {
      this.dom.releasePointerCapture(this.pointerId);
    }
    if (document.pointerLockElement === this.dom) document.exitPointerLock();
    this.pointerId = null;
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

  /**
   * Hover decides where the wheel goes, and nothing else.
   *
   * It used to clear the held keys too, which was the accidental reset the
   * whole bug hid behind: closing the Scene tab removes the canvas, the
   * browser fires `pointerleave` on it, and that was the one path that
   * unstuck the camera.
   */
  private readonly onPointerLeave = () => {
    this.pointerInside = false;
  };

  private readonly onPointerDown = (event: PointerEvent) => {
    if (!this.active || this.mode !== 'idle') return;

    const next = modeForButton(event);
    if (next === null) return;

    event.preventDefault();
    this.setMode(next);
    this.pointerId = event.pointerId;
    this.dom.setPointerCapture(event.pointerId);
    // Focus so the viewport, not whatever was clicked last, receives key events.
    this.dom.focus({ preventScroll: true });

    if (next === 'look') {
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
    this.setMode('idle');
  };

  private readonly onWheel = (event: WheelEvent) => {
    if (!this.active || !this.pointerInside) return;
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
    if (!this.active || isTypingTarget(event.target)) return;

    if (
      event.code === 'KeyF' &&
      this.mode === 'idle' &&
      this.pointerInside &&
      !hasModifier(event)
    ) {
      // Until a selection exists (M4) the pivot is the only focus target, so F
      // recentres the view on it.
      event.preventDefault();
      this.frame(this.pivot, this.focusRadius);
      return;
    }

    // The keys are only ever read while flying, so that is exactly how long a
    // press is worth remembering. Recording them on hover instead meant a
    // press could be recorded in one gesture and spent in the next, and that
    // hover — not the gesture — decided whether a new press was seen at all.
    if (this.mode !== 'look') return;

    this.keys.down(event);
    // Movement keys must not scroll or trigger browser shortcuts while flying.
    event.preventDefault();
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    this.keys.up(event);
  };

  /** Losing the window with keys held would otherwise leave the camera drifting. */
  private readonly onBlur = () => {
    this.setMode('idle');
    this.keys.clear();
  };

  /** A hidden tab stops delivering key events, so it cannot end a gesture. */
  private readonly onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') this.setMode('idle');
  };

  /** Escape releases the lock without a pointerup, so stop navigating too. */
  private readonly onPointerLockChange = () => {
    if (this.mode === 'look' && document.pointerLockElement !== this.dom) {
      this.setMode('idle');
    }
  };
}

function modeForButton(event: {
  button: number;
  altKey: boolean;
}): Exclude<Mode, 'idle'> | null {
  if (event.button === 2) return 'look';
  if (event.button === 1) return 'pan';
  if (event.button === 0 && event.altKey) return 'orbit';
  return null;
}
