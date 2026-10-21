import { useLayoutEffect, useState, type ComponentProps, type RefObject } from 'react';
import { createPortal } from 'react-dom';

/**
 * Where each kind of surface sits on the scale of what covers what, declared in
 * `styles.css`. Whole class names, so that Tailwind finds them.
 */
const LAYER_CLASS = {
  dialog: 'z-dialog',
  menu: 'z-menu',
  toast: 'z-toast',
  prompt: 'z-prompt',
} as const;

export type FloatingLayer = keyof typeof LAYER_CLASS;

function floatingClass(layer: FloatingLayer): string {
  return `app-no-drag fixed ${LAYER_CLASS[layer]}`;
}

interface FloatingProps extends ComponentProps<'div'> {
  layer: FloatingLayer;
}

/**
 * Everything that floats above the editor — a menu, a popover, a dialog, a
 * prompt, a toast — is drawn here, for three reasons that each bit before there
 * was a here.
 *
 * - **At the end of `document.body`.** `position: fixed` is relative to the
 *   viewport only while no ancestor carries a transform, and dockview places
 *   its panels with one: the context menu appeared offset by its panel's own
 *   origin. The toolbar centres its transport with one too, which would also
 *   have held the device popover's stacking beneath the dock. A portal leaves
 *   that ancestor chain, and every scroll container in it, entirely.
 * - **On one scale.** Which surface covers which is `layer`, the order
 *   `styles.css` declares; nothing here picks a number of its own.
 * - **Out of the window's drag region.** On macOS the window has no title bar
 *   of the system's: the page's own title bar drags it (`app-drag`), and over
 *   a drag region the OS takes the pointer before the page sees it — no hover,
 *   no click, no enter or leave, whatever is painted on top. Chromium builds
 *   that region from the boxes in document order, each `drag` box adding its
 *   rectangle and each `no-drag` box removing its own, the later one winning.
 *   So a surface has to remove itself (`app-no-drag`), and from after every
 *   box that drags: the end of the body. When the menu bar and the toolbar
 *   both dragged, the Scene menu was drawn inside the menu bar and removed
 *   nothing — and could not have won anyway, since the toolbar came after the
 *   menu bar and added its band back over every row that hung across it. Those
 *   rows lost the pointer wherever they did not lie over one of the toolbar's
 *   groups of buttons.
 *
 * The third is also why a modal's scrim is a floating box like any other: it
 * covers the chrome as well, and a press on it now closes the dialog wherever it
 * lands, rather than moving the window wherever a drag region lies underneath.
 *
 * Not the other way round — the chrome dropping its drag regions while
 * something is open. Chromium recomputes the region after a layout, and a
 * change of `app-region` alone does not cause one, so the old region would stay
 * in force. A surface appearing or going is a layout: a box that carries its
 * own `no-drag` is always counted.
 */
export function Floating({ layer, className = '', ...props }: FloatingProps) {
  return createPortal(
    <div {...props} className={`${floatingClass(layer)} ${className}`} />,
    document.body,
  );
}

/**
 * `Floating` for a surface built as plain DOM: the asset field's picker and
 * preview, which live inside Tweakpane rather than in React.
 */
export function floatElement(element: HTMLElement, layer: FloatingLayer): void {
  element.classList.add(...floatingClass(layer).split(' '));
  document.body.appendChild(element);
}

/**
 * Where an element is on screen, for a surface that hangs from it.
 *
 * Measured before the first paint, so the surface never shows at the window's
 * corner, and again whenever the window is resized. `null` until then.
 */
export function useAnchorRect(anchor: RefObject<HTMLElement | null>): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    const measure = (): void => {
      const box = anchor.current?.getBoundingClientRect();
      if (box !== undefined) setRect(box);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [anchor]);

  return rect;
}
