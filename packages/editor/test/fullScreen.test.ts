import { describe, expect, it } from 'vitest';
import { seenOnScreen } from '../src/viewport/fullScreen';

/*
 * Whether a view can be seen, given what holds the full screen. Play Full
 * Screen puts the Viewport's stage over everything, and a view outside it
 * would go on being drawn behind it: a second render a frame, for a view
 * nobody can see, in the one mode meant to show the frame rate a player gets.
 */

/** An element that contains itself and exactly the nodes it is given. */
const element = (...inside: object[]) => {
  const self = { contains: (other: unknown): boolean => other === self || inside.includes(other as object) };
  return self;
};

describe('a view and the full screen', () => {
  const editHost = {};
  const gameHost = {};
  const previewHost = {};
  const stage = element(editHost, gameHost);

  it("follows the dock while nothing holds the screen", () => {
    expect(seenOnScreen(null, editHost, true)).toBe(true);
    expect(seenOnScreen(null, editHost, false)).toBe(false);
  });

  it('is seen inside what holds the screen, whatever the dock says', () => {
    // The stage holds the screen, with both of the Viewport's hosts inside it.
    // Which of the two is drawn is not this rule's to say: `viewState` says it.
    expect(seenOnScreen(stage, gameHost, true)).toBe(true);
    expect(seenOnScreen(stage, gameHost, false)).toBe(true);
    expect(seenOnScreen(stage, editHost, true)).toBe(true);
    const root = element();
    expect(seenOnScreen(root, root, false)).toBe(true);
  });

  it('is not seen when something else holds the screen, whatever the dock says', () => {
    expect(seenOnScreen(stage, previewHost, true)).toBe(false);
    expect(seenOnScreen(element(gameHost), editHost, true)).toBe(false);
  });

  it('is not seen with no host to show it in', () => {
    expect(seenOnScreen(stage, null, true)).toBe(false);
  });
});
