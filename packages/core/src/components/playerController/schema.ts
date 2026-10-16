import type { ComponentBase } from '../../scene/primitives';

/** First person, third person, or a free fly with no gravity. */
export type PlayerControllerMode = 'fps' | 'tps' | 'fly';

export const PLAYER_CONTROLLER_MODE_LABELS: Record<PlayerControllerMode, string> = {
  fps: 'FPS',
  tps: 'TPS',
  fly: 'Fly',
};

/**
 * When the on-screen sticks are drawn.
 *
 * `auto` is not a device check. Every property that claims to identify a touch
 * device answers for a laptop with a touchscreen and for a Surface with its
 * keyboard attached — `navigator.maxTouchPoints` and `(pointer: coarse)` both
 * say yes to hardware that is being driven with a mouse. The only honest signal
 * is what someone actually did, so `auto` draws nothing until a real touch
 * arrives and takes it away again at the first mouse move.
 */
export type TouchControlsMode = 'auto' | 'always' | 'never';

export const TOUCH_CONTROLS_LABELS: Record<TouchControlsMode, string> = {
  auto: 'On first touch',
  always: 'Always',
  never: 'Never',
};

export interface PlayerControllerComponent extends ComponentBase {
  type: 'playerController';
  mode: PlayerControllerMode;
  moveSpeed: number;
  sprintMultiplier: number;
  jumpHeight: number;
  mouseSensitivity: number;
  /**
   * How high the eye sits above the character's **feet** — the bottom of its
   * collider, not the entity's origin.
   *
   * It used to mean "above the origin", and that is scene format 9. The origin
   * is the middle of the collider, because physics centres a shape on its body,
   * so the default player — a 1 m box collider and an eye height of 1.7 — put
   * the camera at 2.2 m above the floor on a character 1 m tall. Nothing in the
   * Inspector could have told anyone that; the offset was only knowable by
   * reading `describeCollider`. Format 10 raises every stored value by its
   * collider's half height, so the camera does not move, and from then on the
   * number means what its name says. See `colliderHalfHeight`.
   *
   * Read in FPS mode as the eye, and in TPS mode as the height of the point the
   * camera orbits — which is why the Inspector shows it in both.
   */
  eyeHeight: number;
  /** Camera distance behind the character in TPS mode. */
  cameraDistance: number;
  /**
   * Vertical field of view, in degrees.
   *
   * A field rather than the literal 70 it was, because this camera wins over
   * any the document carries — `Engine.activeCamera` prefers a behaviour's —
   * so a project that wanted a different field had no way at all to ask for
   * one. The default is that same 70, so no scene changes.
   */
  fov: number;
  /** Whether the on-screen sticks are drawn. See `TouchControlsMode`. */
  touchControls: TouchControlsMode;
  /**
   * How fast the look stick turns the camera, in radians per second at full
   * deflection.
   *
   * A separate number from `mouseSensitivity`, and it has to be: a mouse
   * reports a **displacement** in pixels, which is turned into an angle once;
   * a stick reports a **deflection** that has to be integrated over time. They
   * are different units, and a single slider for both would be wrong in one of
   * the two places whatever value it held.
   *
   * 2.5 rad/s is about 143°/s — half a turn in one and a quarter seconds, which
   * is roughly where mobile shooters sit.
   */
  touchLookSpeed: number;
}
