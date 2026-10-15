/*
 * The events a browser counts as the user's activation, which an
 * `AudioContext` needs to start: a key pressed, a mouse button pressed, a
 * finger lifted. Never a move, nor the start of a touch, which may yet turn
 * out to be a scroll.
 */
const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'keydown'] as const;

/*
 * An object rather than `true`: Node's `EventTarget`, which the tests run on,
 * reads only `options.capture` when removing, so a listener added with `true`
 * could never be taken off there.
 */
const CAPTURE = { capture: true } as const;

/**
 * Tries to start the audio on every gesture until it runs, then stops
 * listening. Returns the unsubscribe.
 *
 * Capturing, so that a game that stops an event from propagating still lets
 * this one through. On any gesture rather than on the Play button alone: a page
 * the editor restarted starts without its Play screen, and its sound waits for
 * the first touch, wherever it lands.
 */
export function unlockAudioOnGesture(
  target: EventTarget,
  unlock: () => void,
  running: () => boolean,
): () => void {
  const onGesture = (): void => {
    if (running()) {
      stop();
      return;
    }
    unlock();
  };
  const stop = (): void => {
    for (const type of GESTURES) target.removeEventListener(type, onGesture, CAPTURE);
  };
  for (const type of GESTURES) target.addEventListener(type, onGesture, CAPTURE);
  return stop;
}
