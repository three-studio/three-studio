/*
 * A device's numbers, drawn in a corner of its own screen when the launch
 * options ask: the same lines the editor's row shows, for someone holding the
 * phone rather than looking at the desk.
 *
 * Over the game, and never in its way. The touch sticks' layer fills the
 * screen with zones in its bottom half, so this sits top left, lets every
 * touch through, and cannot be selected by a long press. It may cover the
 * player's Play screen on a page opened by hand: the game already runs behind
 * it.
 */

/** What the corner says: the three lines of `describeDeviceStats`, and the 30 fps warning. */
export interface StatsView {
  lines: string[];
  warning: string | null;
}

export interface StatsOverlay {
  /** `null` hides it; `measuring` says so until the page's first sample. */
  show: (view: StatsView | 'measuring' | null) => void;
}

const STYLE = [
  'position: fixed',
  // The fallback inside `env()` is written out: without one, a browser that
  // does not know the variable drops the whole declaration.
  'top: calc(8px + env(safe-area-inset-top, 0px))',
  'left: calc(8px + env(safe-area-inset-left, 0px))',
  'padding: 4px 6px',
  'border-radius: 3px',
  'font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  'white-space: pre',
  'color: #fff',
  'background: rgba(0, 0, 0, 0.6)',
  'pointer-events: none',
  'user-select: none',
  '-webkit-user-select: none',
  // Over the game's canvas and the touch sticks' layer, which is 10.
  'z-index: 20',
].join(';');

const WARNING_COLOR = '#ffb020';

/** The overlay, made the first time it is shown: a page that never shows it gains no element. */
export function createStatsOverlay(document: Document): StatsOverlay {
  let element: HTMLElement | null = null;

  const line = (text: string, color?: string): HTMLElement => {
    const row = document.createElement('div');
    row.textContent = text;
    if (color !== undefined) row.style.color = color;
    return row;
  };

  return {
    show(view) {
      if (view === null) {
        if (element !== null) element.style.display = 'none';
        return;
      }
      if (element === null) {
        element = document.createElement('div');
        element.style.cssText = STYLE;
        document.body.append(element);
      }
      element.style.display = 'block';
      if (view === 'measuring') {
        element.replaceChildren(line('Measuring…'));
        return;
      }
      element.replaceChildren(
        ...view.lines.map((text) => line(text)),
        ...(view.warning === null ? [] : [line(view.warning, WARNING_COLOR)]),
      );
    },
  };
}
