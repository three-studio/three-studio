import type { TouchControlsMode } from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { isSprintForce, shouldShowTouch, stickToMove } from '../../src/input/touchMath';

/*
 * The decisions behind the on-screen sticks, which is all of them that can be
 * tested: `TouchControls` builds DOM and imports nipplejs, and nipplejs reads
 * `window` while it is being evaluated, so it cannot be loaded under Node at
 * all. Everything worth being sure about was put here for that reason.
 */

describe('when the sticks are on screen', () => {
  /*
   * The whole table, because the interesting cells are the ones nobody thinks
   * to write down: a laptop with a touchscreen reports `maxTouchPoints: 10` and
   * matches `(pointer: coarse)` while being driven with a trackpad, and so does
   * a tablet in a keyboard case. Both of those hand a joystick to somebody who
   * never asked for one, and neither corrects itself afterwards.
   */
  const cases: [TouchControlsMode, boolean, boolean, boolean][] = [
    // mode      sawTouch  sawMouse  shown
    ['never', false, false, false],
    ['never', true, false, false],
    ['never', true, true, false],
    ['always', false, false, true],
    ['always', true, false, true],
    ['always', true, true, true],
    ['auto', false, false, false],
    ['auto', true, false, true],
    ['auto', true, true, false],
  ];

  for (const [mode, sawTouch, sawMouse, shown] of cases) {
    it(`${mode}, touch=${sawTouch}, mouse=${sawMouse} → ${shown ? 'shown' : 'hidden'}`, () => {
      expect(shouldShowTouch(mode, sawTouch, sawMouse)).toBe(shown);
    });
  }

  it('says nothing before anyone has touched anything', () => {
    // The assertion that matters on a desktop: the overlay is never built, not
    // built and hidden. Nothing is created, so nothing can overlap the game.
    expect(shouldShowTouch('auto', false, false)).toBe(false);
  });
});

describe('a stick position turned into movement', () => {
  const length = (v: { x: number; y: number }): number => Math.hypot(v.x, v.y);

  it('ignores a thumb resting inside the dead zone', () => {
    // nipplejs's own `threshold` does not cover this: that one gates the
    // directional events, while `move` fires for a displacement of one pixel.
    expect(stickToMove({ x: 0.05, y: 0.05 })).toEqual({ x: 0, y: 0 });
  });

  it('starts from nothing at the edge of the dead zone rather than jumping', () => {
    // Clipping instead of rescaling would make the character leave from a
    // twelfth of full speed the instant the thumb crossed the line.
    expect(length(stickToMove({ x: 0, y: 0.13 }))).toBeLessThan(0.03);
  });

  it('reaches exactly full throttle at full deflection', () => {
    expect(length(stickToMove({ x: 0, y: 1 }))).toBeCloseTo(1, 6);
  });

  it('keeps the direction it was pushed', () => {
    const diagonal = stickToMove({ x: 0.6, y: 0.6 });
    expect(diagonal.x).toBeCloseTo(diagonal.y, 6);
    // And a diagonal is not 1.41× a straight line, which is the mistake the
    // keyboard path normalises away.
    expect(length(diagonal)).toBeLessThanOrEqual(1);
  });

  it('never asks for more speed than the settings allow', () => {
    // A library version that let the thumb past the ring would otherwise hand
    // the character a speed its own `moveSpeed` never permitted.
    expect(length(stickToMove({ x: 0, y: 1.8 }))).toBeCloseTo(1, 6);
  });
});

describe('the deflection that means run', () => {
  it('walks below the rim and runs at it', () => {
    // nipplejs caps `force` at 1, so the threshold has to sit just inside the
    // rim rather than past it.
    expect(isSprintForce(0.8)).toBe(false);
    expect(isSprintForce(0.96)).toBe(true);
    expect(isSprintForce(1)).toBe(true);
  });
});
