/*
 * Which rows of the hierarchy are worth rendering.
 *
 * A scene with two thousand prefab instances is four thousand rows, and React
 * re-rendered every one of them on every edit: measured at 422 ms per gizmo
 * nudge against 18 ms with the panel closed. Nothing else in the edit path came
 * close — the mutation was 0.5 ms and the binder 1.2 ms.
 *
 * The arithmetic lived inside the component, where nothing could reach it. It
 * is a function of three numbers and it decides whether the panel shows the
 * right rows at all, which makes it the last thing in that file that was a
 * decision rather than a drawing.
 */

/**
 * The height of one row, in pixels, and the only statement of it.
 *
 * It was `24` here and `h-6` on the row's class list, which is the same number
 * written twice in two languages — and the windowing is arithmetic *on* that
 * number, so the two drifting apart would not break a layout, it would scroll
 * to the wrong rows. The row now takes its height from here.
 */
export const ROW_HEIGHT = 24;

/**
 * A margin either side of the viewport, so a fast scroll does not show a blank
 * strip before React catches up.
 */
const OVERSCAN_ROWS = 8;

export interface RowWindow {
  /** First row to render; the start of the slice. */
  first: number;
  /** One past the last; the end of the slice. */
  last: number;
  /** Height of the spacer standing in for the rows above, in pixels. */
  above: number;
  /** And for the rows below. */
  below: number;
}

/**
 * The slice to render, and the two spacers that keep the scrollbar honest.
 *
 * `viewportHeight` is zero until the `ResizeObserver` has reported, which is
 * true for the first render of every hierarchy panel there has ever been. What
 * fills that first render is the overscan; the floor of one row underneath it
 * is a second guard, so the sum is never a viewport of nothing however small
 * the margin becomes.
 */
export function rowWindow(
  rowCount: number,
  scrollTop: number,
  viewportHeight: number,
): RowWindow {
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS);
  const last = Math.min(
    rowCount,
    Math.ceil((scrollTop + Math.max(viewportHeight, ROW_HEIGHT)) / ROW_HEIGHT) + OVERSCAN_ROWS,
  );
  return {
    first,
    last,
    above: first * ROW_HEIGHT,
    below: (rowCount - last) * ROW_HEIGHT,
  };
}
