import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Input, type InputOptions } from '../../src/input/Input';

/*
 * Where the game hears its keys.
 *
 * Window-wide, every key the page received was the game's. That is right for the
 * exported player, where the page is the game, and wrong in the editor, where the
 * page is also a Console and an Inspector: a space typed in a field during Play
 * made the player jump, and never reached the field, because the game kept Space
 * from the browser. Asked to, `Input` hears keys on its element alone.
 *
 * Node's `EventTarget` does not propagate, which is the model wanted here: a key
 * dispatched on the window is one whose target was never the canvas.
 */

/** A key event as `Input` reads it, cancelable so that what it keeps from the browser shows. */
function key(type: 'keydown' | 'keyup', code: string): Event {
  return Object.assign(new Event(type, { cancelable: true }), {
    code,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
  });
}

let win: EventTarget;
let element: EventTarget;
const made: Input[] = [];

function input(options?: InputOptions): Input {
  const created = new Input(element as HTMLElement, options);
  made.push(created);
  return created;
}

beforeEach(() => {
  win = new EventTarget();
  // `pointerLockElement` is read by `releasePointer`, which `dispose` calls.
  const doc = Object.assign(new EventTarget(), { pointerLockElement: null });
  Object.assign(globalThis, { window: win, document: doc });
  // No `requestPointerLock`: a press is not what this is about.
  element = Object.assign(new EventTarget(), { parentElement: null });
});

afterEach(() => {
  for (const each of made.splice(0)) each.dispose();
  Reflect.deleteProperty(globalThis, 'window');
  Reflect.deleteProperty(globalThis, 'document');
});

describe('Input, keys heard window-wide (the default)', () => {
  it('holds a key pressed anywhere on the page, until it is released', () => {
    const keys = input();

    win.dispatchEvent(key('keydown', 'KeyW'));
    expect(keys.isDown('KeyW')).toBe(true);

    win.dispatchEvent(key('keyup', 'KeyW'));
    expect(keys.isDown('KeyW')).toBe(false);
  });

  it('keeps Space from the browser, and leaves it Tab', () => {
    input();

    const space = key('keydown', 'Space');
    win.dispatchEvent(space);
    expect(space.defaultPrevented).toBe(true);

    const tab = key('keydown', 'Tab');
    win.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
  });

  it('drops what is held when the window loses the focus', () => {
    const keys = input();

    win.dispatchEvent(key('keydown', 'KeyW'));
    win.dispatchEvent(new Event('blur'));
    expect(keys.isDown('KeyW')).toBe(false);
  });
});

describe("Input, keys heard on its element (the editor's)", () => {
  it('hears nothing typed elsewhere on the page, and leaves it its Space', () => {
    const keys = input({ keys: 'element' });

    const space = key('keydown', 'Space');
    win.dispatchEvent(key('keydown', 'KeyW'));
    win.dispatchEvent(space);

    expect(keys.isDown('KeyW')).toBe(false);
    expect(keys.isDown('Space')).toBe(false);
    expect(space.defaultPrevented).toBe(false);
  });

  it('holds a key typed in its element, until it is released', () => {
    const keys = input({ keys: 'element' });

    element.dispatchEvent(key('keydown', 'KeyW'));
    expect(keys.isDown('KeyW')).toBe(true);

    element.dispatchEvent(key('keyup', 'KeyW'));
    expect(keys.isDown('KeyW')).toBe(false);
  });

  it('keeps Space, the arrows and Tab from the browser', () => {
    input({ keys: 'element' });

    for (const code of ['Space', 'ArrowLeft', 'Tab']) {
      const press = key('keydown', code);
      element.dispatchEvent(press);
      expect(press.defaultPrevented, code).toBe(true);
    }
  });

  it('drops what is held when its element loses the focus, or the window does', () => {
    const keys = input({ keys: 'element' });

    element.dispatchEvent(key('keydown', 'KeyW'));
    expect(keys.isDown('KeyW')).toBe(true);
    element.dispatchEvent(new Event('blur'));
    expect(keys.isDown('KeyW')).toBe(false);

    element.dispatchEvent(key('keydown', 'KeyD'));
    expect(keys.isDown('KeyD')).toBe(true);
    win.dispatchEvent(new Event('blur'));
    expect(keys.isDown('KeyD')).toBe(false);
  });

  it('hears nothing once disposed', () => {
    const keys = input({ keys: 'element' });
    keys.dispose();

    element.dispatchEvent(key('keydown', 'KeyW'));
    expect(keys.isDown('KeyW')).toBe(false);
  });
});
