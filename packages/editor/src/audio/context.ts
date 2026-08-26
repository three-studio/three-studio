/**
 * The one audio context the editor owns.
 *
 * One, and not one per thing that wants to make a sound (ADR-4). A browser caps
 * how many contexts a page may have — Chrome around six — and, far worse, each
 * one has to be started by its own user gesture. Two contexts means two chances
 * to be silent for a reason nothing reports.
 *
 * Independence between the preview and the running game is bought with a gain
 * node each instead: `AudioEngine` takes a `destination`, so two engines on this
 * one context cannot hear each other.
 *
 * The import dialog is the deliberate exception. `AudioPreview` keeps a context
 * of its own and closes it on dispose, because it works on a file that is not an
 * asset yet, and an abandoned import must leave nothing behind.
 */
let shared: AudioContext | null = null;

/** `null` where there is no Web Audio at all, which the caller must tolerate. */
export function editorAudioContext(): AudioContext | null {
  if (shared !== null) return shared;
  if (typeof AudioContext === 'undefined') return null;
  shared = new AudioContext();
  return shared;
}
