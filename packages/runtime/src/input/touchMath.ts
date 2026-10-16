import type { TouchControlsMode } from '@three-studio/core';

/*
 * The decisions the on-screen sticks rest on, with no DOM in them.
 *
 * The same split this folder already makes: `PressedKeys` is a model of the
 * keyboard and is tested, `Input` binds listeners and is not. Everything here
 * is arithmetic over numbers a stick reported, so it runs in a plain Node test
 * — which matters more than usual, because `TouchControls` cannot: nipplejs
 * reads `window` while it is being imported.
 */

/**
 * How far the thumb has to move before the stick admits it moved at all.
 *
 * A thumb resting on a stick is never exactly centred, and nipplejs's own
 * `threshold` does not help: that one gates the *directional* events (`dir`,
 * `plain`), while `move` fires for a displacement of one pixel. Without a dead
 * zone of our own, a player who parks a thumb on the stick drifts.
 */
const DEAD_ZONE = 0.12;

/**
 * The deflection at which the stick asks to run.
 *
 * nipplejs caps `force` at 1 — its own documentation says "ranges from 0 to 1
 * where 1 is maximum displacement" — so this has to sit just inside the rim
 * rather than past it. Pushing the thumb to the edge is the gesture; 0.95 is
 * close enough to the edge to be deliberate and far enough from it that the
 * last pixel is not required.
 */
const SPRINT_FORCE = 0.95;

export interface Vec2 {
  x: number;
  y: number;
}

export const ZERO: Readonly<Vec2> = { x: 0, y: 0 };

/**
 * Whether the sticks should be on screen, given what has happened so far.
 *
 * `auto` is the whole reason this is a function rather than a boolean on the
 * component. It asks what the player *did*, not what the hardware *is*: a
 * laptop with a touchscreen reports `maxTouchPoints: 10` and matches
 * `(pointer: coarse)` while being driven with a trackpad, and a tablet with a
 * keyboard case does the same. Both of those hand a joystick to someone who
 * never asked for one, and neither corrects itself afterwards.
 *
 * The mouse wins over the touch once both have been seen, because that is the
 * order that actually happens: a phone never produces a mouse move, while a
 * hybrid that was tapped once and is now being used with a mouse should go back
 * to being a desktop. Seeing a touch again brings the sticks back — `sawMouse`
 * is cleared by the caller on the next touch, not latched here.
 */
export function shouldShowTouch(mode: TouchControlsMode, sawTouch: boolean, sawMouse: boolean): boolean {
  if (mode === 'never') return false;
  if (mode === 'always') return true;
  return sawTouch && !sawMouse;
}

/**
 * A stick's reported position, turned into the movement the character asks for.
 *
 * The returned vector's **length is the throttle**, and that is the whole
 * design: `PlayerController.moveOnGround` already multiplies each component by
 * the speed and the step, so a vector two fifths as long is two fifths of the
 * speed without anyone writing a multiplication. The keyboard keeps normalising
 * itself to 1 and therefore keeps behaving exactly as it did.
 *
 * The magnitude comes from the vector rather than from nipplejs's `force`
 * because the two are separately computed and only documented to agree; taking
 * the length here means this cannot be wrong about a detail of a library
 * version. The dead zone is **removed and the remainder rescaled** rather than
 * clipped, so speed climbs from nothing at the edge of the zone instead of
 * jumping to twelve per cent.
 */
export function stickToMove(vector: Vec2): Vec2 {
  const magnitude = Math.hypot(vector.x, vector.y);
  if (magnitude <= DEAD_ZONE) return ZERO;

  // Clamped at 1: a library that let the thumb past the ring would otherwise
  // hand the character a speed its own settings never allowed.
  const scaled = Math.min((magnitude - DEAD_ZONE) / (1 - DEAD_ZONE), 1);
  return { x: (vector.x / magnitude) * scaled, y: (vector.y / magnitude) * scaled };
}

/** Whether a deflection that far out is a run rather than a walk. */
export function isSprintForce(force: number): boolean {
  return force >= SPRINT_FORCE;
}
