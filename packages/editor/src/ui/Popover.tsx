import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useOverlay } from '../state/overlayStore';

/** How close to the window's edges a popover may come, in pixels. */
const MARGIN = 8;
/** The gap between the anchor and the popover hanging under it. */
const GAP = 4;

interface PopoverProps {
  /** What it hangs from: placed under it and centred on it. A press on it is left to it. */
  anchor: RefObject<HTMLElement | null>;
  /** What a screen reader calls the surface. */
  label: string;
  /** In pixels. */
  width: number;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A surface anchored to an element, for content a list cannot hold — a code to
 * scan, a select, a disclosure. `Menu` draws rows and nothing else.
 *
 * Rendered into `document.body`: `position: fixed` is relative to the viewport
 * only while no ancestor carries a transform, and the toolbar's transport is
 * centred with one — which would also trap the popover's stacking beneath the
 * dock. The context menu, the dialogs and the toasts document the same trap.
 *
 * Escape closes it through the overlay stack, as it does a menu. So does a
 * press outside both the popover and its anchor, but only while the popover is
 * on top: a prompt it opened sits above it, and a click in that prompt is not
 * a click away from the popover, which has to be there when the prompt goes.
 */
export function Popover({ anchor, label, width, onClose, children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isTopmost = useOverlay('popover', onClose);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);

  // Placed before the first paint, so it never shows at the window's corner —
  // and never hidden meanwhile, since a hidden element cannot take the focus
  // given to it below.
  useLayoutEffect(() => {
    const measure = (): void => {
      const box = anchor.current?.getBoundingClientRect();
      if (box === undefined) return;
      const centred = box.left + box.width / 2 - width / 2;
      setPlace({
        left: Math.max(MARGIN, Math.min(centred, window.innerWidth - width - MARGIN)),
        top: box.bottom + GAP,
      });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [anchor, width]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent): void {
      if (!isTopmost()) return;
      const target = event.target as Node;
      if (ref.current?.contains(target) || anchor.current?.contains(target)) return;
      onClose();
    }
    // `capture`, as `Menu` does, so the popover closes before the press lands
    // on whatever is behind it.
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [anchor, isTopmost, onClose]);

  // A layout effect, so that its cleanup runs before the popover leaves the
  // page: once it has, the focus inside it is already gone to the body.
  useLayoutEffect(() => {
    const before = document.activeElement;
    const surface = ref.current;
    surface?.focus({ preventScroll: true });
    return () => {
      if (surface?.contains(document.activeElement) && before instanceof HTMLElement) {
        before.focus({ preventScroll: true });
      }
    };
  }, []);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      className="fixed z-menu overflow-y-auto rounded-sm border border-line-soft bg-surface-2 shadow-lg shadow-black/50 outline-none"
      style={{
        width,
        left: place?.left ?? 0,
        top: place?.top ?? 0,
        maxHeight: place === null ? undefined : window.innerHeight - place.top - MARGIN,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
