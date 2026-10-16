import { describe, expect, it, vi } from 'vitest';
import { unlockAudioOnGesture } from '../src/audioGesture';

/*
 * Sound starts at the first gesture, whichever it is. A page the editor
 * restarted skips the Play screen, so the Play button can no longer be the one
 * gesture that unlocks the audio.
 */

describe('unlocking the audio on a gesture', () => {
  it('unlocks on the events a browser counts as a gesture, and on no other', () => {
    const target = new EventTarget();
    const unlock = vi.fn();
    unlockAudioOnGesture(target, unlock, () => false);

    target.dispatchEvent(new Event('pointermove'));
    expect(unlock).not.toHaveBeenCalled();

    target.dispatchEvent(new Event('pointerup'));
    target.dispatchEvent(new Event('keydown'));
    expect(unlock).toHaveBeenCalledTimes(2);
  });

  it('does nothing more once the audio runs', () => {
    const target = new EventTarget();
    const unlock = vi.fn();
    let running = false;
    unlockAudioOnGesture(target, unlock, () => running);

    target.dispatchEvent(new Event('pointerdown'));
    running = true;
    target.dispatchEvent(new Event('touchend'));
    target.dispatchEvent(new Event('keydown'));

    expect(unlock).toHaveBeenCalledTimes(1);
  });

  it('removes every listener when asked', () => {
    const target = new EventTarget();
    const unlock = vi.fn();
    const stop = unlockAudioOnGesture(target, unlock, () => false);

    stop();
    for (const type of ['pointerdown', 'pointerup', 'touchend', 'keydown']) {
      target.dispatchEvent(new Event(type));
    }

    expect(unlock).not.toHaveBeenCalled();
  });
});
