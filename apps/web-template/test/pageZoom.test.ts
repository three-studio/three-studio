import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { blockPageZoom } from '../src/pageZoom';

/*
 * The exported page holds still under a pinch. Two thumbs on the touch sticks
 * are a pinch as far as a browser knows, and a zoomed page crops the game with
 * no way back but the same gesture.
 */

/** A cancelable event, with the fields the guard reads. */
function event(type: string, fields: Record<string, unknown> = {}): Event {
  const created = new Event(type, { cancelable: true });
  for (const [name, value] of Object.entries(fields)) {
    Object.defineProperty(created, name, { value });
  }
  return created;
}

/** What `touches` looks like with this many fingers down. */
const fingers = (count: number) => ({ length: count });

describe('refusing the zoom gestures', () => {
  it("refuses WebKit's pinch events, the ones iOS zooms with", () => {
    const target = new EventTarget();
    blockPageZoom(target);
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      const pinch = event(type);
      target.dispatchEvent(pinch);
      expect(pinch.defaultPrevented, type).toBe(true);
    }
  });

  it('refuses a move of two fingers, and leaves one finger to the game', () => {
    const target = new EventTarget();
    blockPageZoom(target);

    const two = event('touchmove', { touches: fingers(2) });
    const one = event('touchmove', { touches: fingers(1) });
    target.dispatchEvent(two);
    target.dispatchEvent(one);

    expect(two.defaultPrevented).toBe(true);
    expect(one.defaultPrevented).toBe(false);
  });

  it("refuses a wheel turned with Ctrl, a trackpad's pinch, and leaves a plain wheel alone", () => {
    const target = new EventTarget();
    blockPageZoom(target);

    const pinch = event('wheel', { ctrlKey: true });
    const scroll = event('wheel', { ctrlKey: false });
    target.dispatchEvent(pinch);
    target.dispatchEvent(scroll);

    expect(pinch.defaultPrevented).toBe(true);
    expect(scroll.defaultPrevented).toBe(false);
  });

  it('leaves the start and the end of a touch alone, so a tap still clicks', () => {
    const target = new EventTarget();
    blockPageZoom(target);
    for (const type of ['touchstart', 'touchend']) {
      const touch = event(type, { touches: fingers(2) });
      target.dispatchEvent(touch);
      expect(touch.defaultPrevented, type).toBe(false);
    }
  });

  it('removes every listener when asked', () => {
    const target = new EventTarget();
    const stop = blockPageZoom(target);
    stop();

    const dispatched = [
      event('gesturestart'),
      event('touchmove', { touches: fingers(2) }),
      event('wheel', { ctrlKey: true }),
    ];
    for (const one of dispatched) target.dispatchEvent(one);

    expect(dispatched.map((one) => one.defaultPrevented)).toEqual([false, false, false]);
  });
});

/*
 * The page's half, read as the export ships it: Android honours the viewport
 * and the CSS, and iOS the CSS. A template edited without them would zoom
 * again with every test above still passing.
 */
describe('the player page', () => {
  const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  it('asks for no zoom in its viewport', () => {
    const viewport = /<meta name="viewport" content="([^"]*)"/.exec(page)?.[1] ?? '';
    expect(viewport).toContain('maximum-scale=1');
    expect(viewport).toContain('user-scalable=no');
  });

  it('refuses the browser its gestures on the whole page', () => {
    const rule = /html, body \{([^}]*touch-action[^}]*)\}/.exec(page)?.[1] ?? '';
    expect(rule).toContain('touch-action: none');
    expect(rule).toContain('overscroll-behavior: none');
  });
});
