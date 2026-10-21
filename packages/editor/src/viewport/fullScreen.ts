/**
 * Whether a view can be seen, given what holds the full screen.
 *
 * While nothing does, the dock is the one that knows, and `docked` is its
 * answer (`Presentation.onScreen`). While something does, the screen decides:
 * a view inside the element that holds it is seen, and every other view is
 * behind it, whatever the dock says.
 *
 * The second half is Play Full Screen. Its Game panel goes in front of
 * everything, and the Scene view went on being drawn behind it: the cost
 * `onScreen` was written to stop, 18 016 draw calls a frame instead of 9 006,
 * in the one mode meant to show the frame rate a player gets. The dock cannot
 * tell, since to it both panels are still showing.
 *
 * Structurally typed so that a test without a DOM can ask it.
 */
export function seenOnScreen(
  fullScreenElement: { contains(other: unknown): boolean } | null,
  host: unknown,
  docked: boolean,
): boolean {
  if (fullScreenElement === null) return docked;
  return host !== null && fullScreenElement.contains(host);
}
