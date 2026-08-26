import type { AudioParamLike } from './AudioContextLike';

/**
 * How long a value takes to reach its target when nothing says otherwise.
 *
 * Twenty milliseconds is inaudible as a delay and long enough to remove the
 * discontinuity. Writing `param.value` directly instead produces a step in the
 * waveform, and a step is a click — the "zipper noise" every mixer written
 * against Web Audio hits on its first volume slider.
 */
export const DEFAULT_RAMP = 0.02;

/** Moves a parameter to a value over `seconds`, cancelling whatever was scheduled. */
export function rampTo(
  param: AudioParamLike,
  value: number,
  now: number,
  seconds = DEFAULT_RAMP,
): void {
  // Reading `.value` mid-ramp gives where the ramp has got to, so pinning it
  // first is what keeps the new ramp continuous with the old one instead of
  // jumping back to where the last one started.
  const current = param.value;
  param.cancelScheduledValues(now);
  param.setValueAtTime(current, now);
  if (seconds <= 0) {
    param.setValueAtTime(value, now);
    return;
  }
  param.linearRampToValueAtTime(value, now + seconds);
}

/** Sets a parameter with no ramp at all, for a value nobody can hear change. */
export function setNow(param: AudioParamLike, value: number, now: number): void {
  param.cancelScheduledValues(now);
  param.setValueAtTime(value, now);
  param.value = value;
}
