import { PressedKeys } from '@three-studio/runtime';
import { describe, expect, it } from 'vitest';
import { flyAxes } from '../src/viewport/FlyControls';

function held(...codes: string[]): PressedKeys {
  const keys = new PressedKeys();
  for (const code of codes) {
    keys.down({ code, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false });
  }
  return keys;
}

/*
 * `FlyControls` itself needs a canvas, so only the decision is tested here —
 * the same split as `shortcutsApply` in shortcuts.test.ts.
 */
describe('flyAxes', () => {
  it('maps each binding to its axis', () => {
    expect(flyAxes(held('KeyW')).forward).toBe(1);
    expect(flyAxes(held('KeyS')).forward).toBe(-1);
    expect(flyAxes(held('KeyD')).right).toBe(1);
    expect(flyAxes(held('KeyA')).right).toBe(-1);
    expect(flyAxes(held('KeyE')).up).toBe(1);
    expect(flyAxes(held('KeyQ')).up).toBe(-1);
  });

  it('accepts the arrow keys as aliases', () => {
    expect(flyAxes(held('ArrowUp')).forward).toBe(1);
    expect(flyAxes(held('ArrowDown')).forward).toBe(-1);
    expect(flyAxes(held('ArrowRight')).right).toBe(1);
    expect(flyAxes(held('ArrowLeft')).right).toBe(-1);
  });

  it('cancels opposite keys instead of letting one win', () => {
    // A key that is somehow still held stops its axis rather than reversing it.
    expect(flyAxes(held('KeyW', 'KeyS')).forward).toBe(0);
    expect(flyAxes(held('KeyA', 'KeyD')).right).toBe(0);
  });

  it('stands still with nothing held', () => {
    expect(flyAxes(held())).toEqual({ forward: 0, right: 0, up: 0 });
  });

  it('combines axes for a diagonal', () => {
    expect(flyAxes(held('KeyW', 'KeyD', 'KeyE'))).toEqual({ forward: 1, right: 1, up: 1 });
  });

  it('reads nothing from the keys a chord swallowed', () => {
    // ⌘S is the press whose keyup macOS withholds; it never reaches the axes.
    const keys = new PressedKeys();
    keys.down({ code: 'MetaLeft', altKey: false, ctrlKey: false, metaKey: true, shiftKey: false });
    keys.down({ code: 'KeyS', altKey: false, ctrlKey: false, metaKey: true, shiftKey: false });
    keys.up({ code: 'MetaLeft', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false });

    expect(flyAxes(keys).forward).toBe(0);
  });
});
