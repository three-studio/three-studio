import { describe, expect, it } from 'vitest';
import { ROW_HEIGHT, rowWindow } from '../src/panels/hierarchyWindow';

/*
 * The windowing of the hierarchy, which decides whether the panel shows the
 * right rows at all.
 *
 * It lived inside the component, where nothing could reach it — and it is the
 * one thing in that file where being wrong is not a layout that looks off but a
 * list scrolled to the wrong place. A scene of four thousand rows is what it
 * exists for: rendering all of them measured at 422 ms per gizmo nudge.
 */

/** Rows that fit in a viewport of `height`, ignoring the overscan margin. */
const fits = (height: number): number => height / ROW_HEIGHT;

describe('the rows worth rendering', () => {
  it('starts at the top of an unscrolled list', () => {
    const { first, above } = rowWindow(1000, 0, 480);
    expect(first).toBe(0);
    expect(above).toBe(0);
  });

  it('renders more than the viewport holds, so a fast scroll shows no blank strip', () => {
    const window = rowWindow(1000, 0, 480);
    expect(window.last).toBeGreaterThan(fits(480));
  });

  it('follows the scroll', () => {
    // Twenty rows down, less the overscan margin above.
    const { first } = rowWindow(1000, 20 * ROW_HEIGHT, 480);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(20);
    expect(rowWindow(1000, 40 * ROW_HEIGHT, 480).first).toBeGreaterThan(first);
  });

  it('keeps the spacers in step with the slice', () => {
    // The two spacers stand in for every row not rendered. Their heights plus
    // the rendered ones are the full list, which is what keeps the scrollbar
    // the length it would be if all four thousand rows were there.
    const rows = 1000;
    const { first, last, above, below } = rowWindow(rows, 300, 480);
    expect(above).toBe(first * ROW_HEIGHT);
    expect(below).toBe((rows - last) * ROW_HEIGHT);
    expect(above + (last - first) * ROW_HEIGHT + below).toBe(rows * ROW_HEIGHT);
  });

  it('never asks for rows past the end', () => {
    // `slice` would forgive it; the bottom spacer would not — a negative height
    // is an element the browser drops, and the scrollbar jumps as you reach the
    // end of a long list.
    const { last, below } = rowWindow(10, 10_000, 480);
    expect(last).toBe(10);
    expect(below).toBe(0);
  });

  it('never asks for rows before the start', () => {
    // A scroll of zero is one overscan margin above row zero.
    expect(rowWindow(1000, 0, 480).first).toBe(0);
    expect(rowWindow(1000, ROW_HEIGHT, 480).first).toBe(0);
  });

  it('renders something before the viewport has been measured', () => {
    // `height` is zero until the `ResizeObserver` reports, which is true of the
    // first render of every hierarchy panel there has ever been. A window of
    // nothing there would be an empty panel that fills in only once something
    // resizes it.
    const { first, last } = rowWindow(1000, 0, 0);
    expect(first).toBe(0);
    expect(last).toBeGreaterThan(0);
  });

  it('has nothing to render for an empty list', () => {
    expect(rowWindow(0, 0, 480)).toEqual({ first: 0, last: 0, above: 0, below: 0 });
  });
});
