import type { Voice } from './Voice';

/**
 * Unity's default, and a good one for the web too.
 *
 * Thirty-two simultaneous sources is well past what a scene needs and well
 * short of what the audio thread minds. The number that matters is not really a
 * count of voices — no browser publishes a limit — it is the node count and the
 * allocation churn behind it, and thirty-two keeps both boring.
 */
export const DEFAULT_MAX_VOICES = 32;

/**
 * How many sounds may be audible at once, and who loses when too many want to be.
 *
 * Every engine in the benchmark has this and none of them added it late: the
 * case that forces it — a weapon firing once a frame for two seconds — turns up
 * early, and it turns up as a crackle rather than as a flat profile.
 *
 * The rule is Unity's: **`0` is the highest priority**. At the ceiling the voice
 * with the largest number goes first, and among equals the oldest, because a
 * sound that has been playing for a while has already been heard.
 */
export class VoicePool {
  private readonly voices: Voice[] = [];

  constructor(private readonly max: number = DEFAULT_MAX_VOICES) {}

  get live(): readonly Voice[] {
    return this.voices;
  }

  get size(): number {
    return this.voices.length;
  }

  /**
   * Makes room for a sound of this priority, stealing if it has to.
   *
   * @returns `false` when everything already playing matters more, in which case
   *   the caller must not build a voice at all — refusing before allocating is
   *   the whole point of asking first.
   */
  admit(priority: number): boolean {
    if (this.voices.length < this.max) return true;

    const worst = this.worst();
    if (worst === null || worst.priority < priority) return false;

    // Stopped with no fade: the slot is wanted now, and a stolen voice that
    // lingered would defeat the ceiling it was stolen for.
    worst.stop(0);
    this.remove(worst);
    return true;
  }

  add(voice: Voice): void {
    this.voices.push(voice);
  }

  /** Advances every voice and drops the ones that are over. */
  tick(now: number): void {
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const voice = this.voices[i];
      if (voice && voice.tick(now)) this.voices.splice(i, 1);
    }
  }

  stopAll(fadeOut = 0): void {
    for (const voice of [...this.voices]) voice.stop(fadeOut);
    if (fadeOut <= 0) this.voices.length = 0;
  }

  private worst(): Voice | null {
    let worst: Voice | null = null;
    for (const voice of this.voices) {
      if (worst === null) {
        worst = voice;
        continue;
      }
      if (voice.priority > worst.priority) {
        worst = voice;
        continue;
      }
      if (voice.priority === worst.priority && voice.since < worst.since) worst = voice;
    }
    return worst;
  }

  private remove(voice: Voice): void {
    const index = this.voices.indexOf(voice);
    if (index >= 0) this.voices.splice(index, 1);
  }
}
