import { describe, expect, it } from 'vitest';
import { seenOnScreen } from '../src/viewport/fullScreen';

/*
 * Whether a view can be seen, given what holds the full screen. Play Full
 * Screen puts the Game panel over everything, and the Scene view would go on
 * being drawn behind it: a second render a frame, for a view nobody can see,
 * in the one mode meant to show the frame rate a player gets.
 */

/** An element that contains itself and exactly the nodes it is given. */
const element = (...inside: object[]) => {
  const self = { contains: (other: unknown): boolean => other === self || inside.includes(other as object) };
  return self;
};

describe('a view and the full screen', () => {
  const sceneHost = {};
  const gameHost = {};

  it("follows the dock while nothing holds the screen", () => {
    expect(seenOnScreen(null, sceneHost, true)).toBe(true);
    expect(seenOnScreen(null, sceneHost, false)).toBe(false);
  });

  it('is seen inside what holds the screen, whatever the dock says', () => {
    // The Game panel's root holds the screen; the game's host is inside it.
    expect(seenOnScreen(element(gameHost), gameHost, true)).toBe(true);
    expect(seenOnScreen(element(gameHost), gameHost, false)).toBe(true);
    const root = element();
    expect(seenOnScreen(root, root, false)).toBe(true);
  });

  it('is not seen when something else holds the screen, whatever the dock says', () => {
    expect(seenOnScreen(element(gameHost), sceneHost, true)).toBe(false);
  });

  it('is not seen with no host to show it in', () => {
    expect(seenOnScreen(element(gameHost), null, true)).toBe(false);
  });
});
