import { describe, expect, it } from 'vitest';
import { DELAY_MS, WARM_MS, delayFor, placeTooltip, tooltip } from '../src/ui/Tooltip';

/*
 * The editor's own tooltips: what a control carries, how long one waits, and
 * where it lands. The host that listens and draws needs a DOM and is checked in
 * the real app; these are the decisions it takes, which do not.
 */

const VIEWPORT = { width: 1200, height: 800 };
const SIZE = { width: 120, height: 24 };

/** A 28 px button with its top-left corner here. */
function button(left: number, top: number) {
  return { left, top, bottom: top + 28, width: 28 };
}

describe('tooltip attributes', () => {
  it('carry the words, and the key and the hint only when there are some', () => {
    expect(tooltip('Snap to grid')).toEqual({ 'data-tooltip': 'Snap to grid' });
    expect(tooltip('Move', { keys: 'W' })).toEqual({
      'data-tooltip': 'Move',
      'data-tooltip-keys': 'W',
    });
    expect(tooltip('Step one frame', { keys: undefined, hint: 'Pause first' })).toEqual({
      'data-tooltip': 'Step one frame',
      'data-tooltip-hint': 'Pause first',
    });
  });

  it('leave an empty key out rather than draw an empty column', () => {
    expect(tooltip('Play', { keys: '' })).toEqual({ 'data-tooltip': 'Play' });
  });

  it('are nothing at all without words, as `title={undefined}` was', () => {
    expect(tooltip(undefined)).toEqual({});
    expect(tooltip(null, { keys: 'W' })).toEqual({});
    expect(tooltip('')).toEqual({});
  });
});

describe('the delay before a tooltip', () => {
  it('is the full one from cold', () => {
    expect(delayFor(10_000, 0)).toBe(DELAY_MS);
  });

  it('is none just after another tooltip went, so a toolbar reads at a glance', () => {
    const warmUntil = 10_000 + WARM_MS;
    expect(delayFor(10_000 + WARM_MS - 1, warmUntil)).toBe(0);
    expect(delayFor(10_000 + WARM_MS, warmUntil)).toBe(DELAY_MS);
  });
});

describe('where a tooltip goes', () => {
  it('hangs under its control, centred on it', () => {
    const place = placeTooltip(button(500, 40), SIZE, VIEWPORT);
    expect(place.top).toBe(40 + 28 + 6);
    expect(place.left + SIZE.width / 2).toBe(500 + 14);
  });

  it('goes above when the window has no room below', () => {
    const place = placeTooltip(button(500, 770), SIZE, VIEWPORT);
    expect(place.top).toBe(770 - 6 - SIZE.height);
  });

  it('stays inside the window at either edge', () => {
    expect(placeTooltip(button(0, 40), SIZE, VIEWPORT).left).toBe(8);
    expect(placeTooltip(button(1190, 40), SIZE, VIEWPORT).left).toBe(1200 - SIZE.width - 8);
  });

  it('keeps its top edge in the window when it fits neither below nor above', () => {
    const tall = { width: 120, height: 790 };
    expect(placeTooltip(button(500, 40), tall, VIEWPORT).top).toBe(8);
  });
});
