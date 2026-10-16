/*
 * How a page tells that the one before it, in this tab, was ended in the
 * foreground — on iOS, what running out of memory looks like: the browser ends
 * the page without any event, then loads it again, and nothing on screen says
 * why the game started over.
 *
 * A player page marks itself alive in `sessionStorage`, which lives outside
 * the page's process and survives it, and takes the mark as it goes: every
 * navigation and every reload fires `pagehide`. A mark found as a page starts
 * is one nobody took. Hidden, it is a tab ended in the background, which a
 * phone does to any page: not counted.
 *
 * Pure, over anything shaped like a `Storage`. Every call is guarded: a
 * private mode may refuse storage, and that means no detection, never an
 * error.
 */

/** The mark: `visible` or `hidden`, as the page was when it last changed. */
const ALIVE_KEY = 'three-studio.device.alive';

export type MarkStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * Whether the page before this one was ended in the foreground, and loaded
 * again by the browser. Takes the mark, so that it is read once. A load the
 * editor asked for is never one: its page went through `pagehide` anyway.
 */
export function readReload(storage: MarkStorage, asked: boolean): boolean {
  try {
    const mark = storage.getItem(ALIVE_KEY);
    storage.removeItem(ALIVE_KEY);
    return mark === 'visible' && !asked;
  } catch {
    return false;
  }
}

/** Marks this page alive, as seen or hidden: on start, on each change, and back from the cache. */
export function markAlive(storage: MarkStorage, visible: boolean): void {
  try {
    storage.setItem(ALIVE_KEY, visible ? 'visible' : 'hidden');
  } catch {
    // No detection in this tab.
  }
}

/** Takes the mark, as the page goes the way a page goes. */
export function clearAlive(storage: MarkStorage): void {
  try {
    storage.removeItem(ALIVE_KEY);
  } catch {
    // No detection in this tab.
  }
}
