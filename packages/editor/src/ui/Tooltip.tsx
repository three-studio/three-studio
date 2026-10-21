import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { hasOverlay } from '../state/overlayStore';
import { Floating } from './Floating';

/** How long the pointer rests on a control before its tooltip shows, in ms. */
export const DELAY_MS = 500;

/**
 * How long after a tooltip goes that the next one shows at once, in ms. The
 * pointer running along a toolbar then reads each button without waiting
 * again, as it does along a native one.
 */
export const WARM_MS = 300;

/** How close to the window's edges a tooltip may come — `Popover`'s margin. */
const MARGIN = 8;

/** The gap between a control and the tooltip under it. */
const GAP = 6;

const SELECTOR = '[data-tooltip]';
const ATTRIBUTES = ['data-tooltip', 'data-tooltip-keys', 'data-tooltip-hint'];

/** What `tooltip` puts on an element, for `TooltipHost` to read. */
export interface TooltipAttributes {
  'data-tooltip': string;
  'data-tooltip-keys'?: string;
  'data-tooltip-hint'?: string;
}

/**
 * The tooltip an element shows, as attributes to spread onto it.
 *
 * - `text` is the first line: what the control is, or what it does.
 * - `keys` is the key that does the same, written the way a menu writes it
 *   (`⌘S`, `⇧Esc`, `W`), and drawn where a menu draws it: on the right, dim.
 * - `hint` is a second, dimmer line: what the current value means, or why the
 *   control is switched off.
 *
 * Attributes rather than a component wrapped around each control: one host
 * reads them for the whole window, so a control needs no state of its own, and
 * the inspector's fields — plain DOM inside Tweakpane, not React — take the
 * same tooltip by setting `dataset.tooltip`.
 *
 * Not `title`. macOS draws a `title` itself, in a window of the window
 * server's, in the system's look, and only once the real pointer has rested a
 * long while: the toolbar was full of tooltips that nobody ever saw. An element
 * carrying both would show both, so a control has one or the other.
 *
 * No text — `null`, `undefined`, empty — is no tooltip, as `title={undefined}`
 * was no title: a field shows its full value only once it has one.
 */
export function tooltip(
  text: string | null | undefined,
  { keys, hint }: { keys?: string; hint?: string } = {},
): Partial<TooltipAttributes> {
  if (!text) return {};
  return {
    'data-tooltip': text,
    ...(keys ? { 'data-tooltip-keys': keys } : {}),
    ...(hint ? { 'data-tooltip-hint': hint } : {}),
  };
}

interface Box {
  left: number;
  top: number;
  bottom: number;
  width: number;
}

interface Size {
  width: number;
  height: number;
}

/**
 * Where a tooltip of this size goes for this control: under it and centred on
 * it, above it when the window has no room below, and kept `MARGIN` inside the
 * window either way.
 *
 * Under first, because the controls that carry tooltips mostly sit in bars at
 * the top of the window and of each panel. Above, a tooltip on the toolbar
 * would cover the title bar, the window's one handle.
 */
export function placeTooltip(anchor: Box, size: Size, viewport: Size): { left: number; top: number } {
  const below = anchor.bottom + GAP;
  const top =
    below + size.height <= viewport.height - MARGIN
      ? below
      : Math.max(MARGIN, anchor.top - GAP - size.height);
  const centred = anchor.left + anchor.width / 2 - size.width / 2;
  const left = Math.max(MARGIN, Math.min(centred, viewport.width - size.width - MARGIN));
  return { left, top };
}

/** How long to wait before showing a tooltip: nothing while warm, `DELAY_MS` otherwise. */
export function delayFor(now: number, warmUntil: number): number {
  return now < warmUntil ? 0 : DELAY_MS;
}

interface Shown {
  text: string;
  keys: string | null;
  hint: string | null;
  /** Where the control is, measured when the tooltip opened or its words changed. */
  anchor: DOMRect;
}

function contentOf(element: HTMLElement): Shown | null {
  const text = element.dataset.tooltip;
  if (!text) return null;
  return {
    text,
    keys: element.dataset.tooltipKeys ?? null,
    hint: element.dataset.tooltipHint ?? null,
    anchor: element.getBoundingClientRect(),
  };
}

function anchorOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>(SELECTOR) : null;
}

/**
 * Draws the tooltip of whatever control the pointer rests on, for the whole
 * window. Mounted once per window, as `ToastHost` is.
 *
 * It listens on the document rather than on each control, and that covers a
 * disabled button too: Chromium sends a disabled control every pointer event
 * but the press, and a tooltip saying why Step is greyed out is the one most
 * worth having. React would not have helped there — it drops `onMouseEnter` on
 * a disabled button itself.
 *
 * It goes the way a native tooltip goes: when the pointer leaves the control or
 * the window, on a press — and it stays away while the pointer stays on what
 * was pressed, since the press already answered it — on a key, a wheel, a
 * resize, the window losing focus, and when the control itself goes.
 */
export function TooltipHost() {
  const [shown, setShown] = useState<Shown | null>(null);

  useEffect(() => {
    // The control under the pointer that carries a tooltip.
    let anchor: HTMLElement | null = null;
    // The control last pressed: quiet until the pointer has left it.
    let pressed: HTMLElement | null = null;
    // The control whose tooltip is up.
    let open: HTMLElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let warmUntil = 0;
    let observer: MutationObserver | null = null;
    let frame = 0;

    function cancel(): void {
      clearTimeout(timer);
      timer = undefined;
    }

    function close(warm: boolean): void {
      cancel();
      if (open === null) return;
      observer?.disconnect();
      observer = null;
      cancelAnimationFrame(frame);
      open = null;
      if (warm) warmUntil = performance.now() + WARM_MS;
      setShown(null);
    }

    function show(element: HTMLElement): void {
      timer = undefined;
      if (!element.isConnected) return;
      /*
       * With a menu or a popover open, only its own controls show a tooltip.
       * The Global ▾ menu hangs under its button: the pointer crossing the
       * button on its way to a row would otherwise lay the button's tooltip
       * over the rows. A dialog's scrim already keeps the pointer off the
       * chrome behind it; a menu has none.
       */
      if (hasOverlay() && element.closest('[data-layer]') === null) return;
      const content = contentOf(element);
      if (content === null) return;
      open = element;
      setShown(content);
      // The words can change while they are read: the Device button's line
      // counts the devices connected, and one may connect meanwhile.
      observer = new MutationObserver(() => {
        const next = contentOf(element);
        if (next === null) close(false);
        else setShown(next);
      });
      observer.observe(element, { attributes: true, attributeFilter: ATTRIBUTES });
      // A control can leave the page under a pointer that does not move — a
      // device's row when the device goes — and no pointer event says so.
      const watch = (): void => {
        if (!element.isConnected) close(false);
        else frame = requestAnimationFrame(watch);
      };
      frame = requestAnimationFrame(watch);
    }

    function onPointerOver(event: PointerEvent): void {
      if (event.pointerType === 'touch') return;
      const next = anchorOf(event.target);
      // Still the same control: the pointer only crossed into its icon.
      if (next === anchor) return;
      close(open !== null);
      anchor = next;
      if (pressed !== next) pressed = null;
      // A held button is a drag — a gizmo, a splitter, a row being moved —
      // and the tooltips it crosses are not being asked for.
      if (next === null || next === pressed || event.buttons !== 0) return;
      const delay = delayFor(performance.now(), warmUntil);
      if (delay === 0) show(next);
      else timer = setTimeout(() => show(next), delay);
    }

    function onPointerOut(event: PointerEvent): void {
      // Out of the window: nothing is entered, so no `pointerover` follows.
      if (event.relatedTarget !== null) return;
      close(false);
      anchor = null;
      pressed = null;
    }

    function onPointerDown(event: PointerEvent): void {
      close(false);
      pressed = anchorOf(event.target);
    }

    function onScroll(event: Event): void {
      /*
       * Only a scroll that moves the control. The Console scrolls itself to its
       * last line whenever a message arrives, and a running game can log every
       * frame: closing on any scroll took the tooltip away from a toolbar
       * button the instant it showed.
       */
      const scrolled = event.target;
      if (!(scrolled instanceof Node)) return;
      if ((open !== null && scrolled.contains(open)) || (anchor !== null && scrolled.contains(anchor))) {
        close(false);
        anchor = null;
      }
    }

    function dismiss(): void {
      close(false);
    }

    document.addEventListener('pointerover', onPointerOver, true);
    document.addEventListener('pointerout', onPointerOut, true);
    // `capture`, as the menus listen, so a press that something else stops is
    // still seen here.
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('wheel', dismiss, { capture: true, passive: true });
    window.addEventListener('keydown', dismiss, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    return () => {
      close(false);
      document.removeEventListener('pointerover', onPointerOver, true);
      document.removeEventListener('pointerout', onPointerOut, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('wheel', dismiss, { capture: true });
      window.removeEventListener('keydown', dismiss, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
    };
  }, []);

  const ref = useRef<HTMLDivElement>(null);
  // Tagged with what it was measured for, so a tooltip whose words changed is
  // never drawn where the previous one fitted.
  const [place, setPlace] = useState<{ for: Shown; left: number; top: number } | null>(null);

  // Drawn unseen first, measured, then placed — all before the first paint, as
  // `Popover` does — since where it goes depends on how big it came out.
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (shown === null || box === undefined) return;
    setPlace({
      for: shown,
      ...placeTooltip(shown.anchor, box, { width: window.innerWidth, height: window.innerHeight }),
    });
  }, [shown]);

  if (shown === null) return null;
  const placed = place?.for === shown ? place : null;

  return (
    <Floating
      layer="tooltip"
      ref={ref}
      role="tooltip"
      className="pointer-events-none max-w-72 rounded-sm border border-line bg-surface-3 px-2 py-1 text-2xs text-ink shadow-lg shadow-black/50"
      style={{
        left: placed?.left ?? 0,
        top: placed?.top ?? 0,
        visibility: placed === null ? 'hidden' : undefined,
      }}
    >
      <div className="flex items-baseline gap-3">
        <span className="min-w-0 whitespace-pre-line break-words">{shown.text}</span>
        {shown.keys !== null && (
          <span className="ml-auto shrink-0 whitespace-nowrap text-ink-dim">{shown.keys}</span>
        )}
      </div>
      {shown.hint !== null && (
        <p className="mt-0.5 whitespace-pre-line break-words text-ink-muted">{shown.hint}</p>
      )}
    </Floating>
  );
}
