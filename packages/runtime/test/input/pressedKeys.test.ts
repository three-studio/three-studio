import { describe, expect, it } from 'vitest';
import { PressedKeys, type KeyEventLike } from '../../src/input/PressedKeys';

/** A `KeyboardEvent` reduced to what `PressedKeys` reads. */
function key(code: string, modifiers: Partial<KeyEventLike> = {}): KeyEventLike {
  return {
    code,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...modifiers,
  };
}

/*
 * The set is a guess about the physical keyboard, and the browser does not
 * promise to correct it. macOS withholds `keyup` for every ordinary key while
 * Cmd is held, so a plain `add` on `keydown` left `KeyS` held forever after a
 * ⌘S — which flew the editor camera backwards on its own, and made W look as
 * though it had reversed.
 */
describe('PressedKeys', () => {
  it('round-trips an ordinary key', () => {
    const keys = new PressedKeys();

    keys.down(key('KeyW'));
    expect(keys.has('KeyW')).toBe(true);
    expect(keys.anyDown(['KeyW', 'ArrowUp'])).toBe(true);

    keys.up(key('KeyW'));
    expect(keys.has('KeyW')).toBe(false);
    expect(keys.size).toBe(0);
  });

  it('records nothing for a chord, whose keyup may never arrive', () => {
    const keys = new PressedKeys();

    // ⌘S over the viewport: save, not "fly backwards".
    keys.down(key('MetaLeft', { metaKey: true }));
    keys.down(key('KeyS', { metaKey: true }));
    expect(keys.has('KeyS')).toBe(false);

    // Only the modifier's release is delivered, and it leaves nothing behind.
    keys.up(key('MetaLeft'));
    expect(keys.size).toBe(0);
  });

  it('drops what was held when a chord starts', () => {
    const keys = new PressedKeys();

    keys.down(key('KeyW'));
    keys.down(key('ControlLeft', { ctrlKey: true }));

    expect(keys.has('KeyW')).toBe(false);
  });

  it('keeps Shift, which is a modifier the camera actually uses', () => {
    const keys = new PressedKeys();

    keys.down(key('ShiftLeft', { shiftKey: true }));
    keys.down(key('KeyW', { shiftKey: true }));

    expect(keys.anyDown(['ShiftLeft', 'ShiftRight'])).toBe(true);
    expect(keys.has('KeyW')).toBe(true);
  });

  it('purges a modifier the next event reports released', () => {
    const keys = new PressedKeys();
    keys.down(key('ShiftLeft', { shiftKey: true }));

    // The keyup never came — the window was elsewhere when Shift was let go.
    keys.down(key('KeyW'));

    expect(keys.has('ShiftLeft')).toBe(false);
    expect(keys.has('KeyW')).toBe(true);
  });

  it('clears on demand, for the transitions an owner controls', () => {
    const keys = new PressedKeys();
    keys.down(key('KeyW'));
    keys.down(key('KeyD'));

    keys.clear();

    expect(keys.size).toBe(0);
  });
});
