import { ChevronRight, Trash2, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useOverlay } from '../state/overlayStore';
import { Floating, useAnchorRect } from './Floating';

export interface MenuItem {
  label: string;
  /** Drawn before the label, for lists where the rows also appear as buttons. */
  icon?: LucideIcon;
  shortcut?: string;
  disabled?: boolean;
  checked?: boolean;
  onSelect?: () => void;
  /** Renders a delete affordance on the row; the menu stays open afterwards. */
  onDelete?: () => void;
  /** Nested entries, opened to the side on hover. */
  submenu?: readonly MenuEntry[];
  /**
   * What tells this row from its siblings: its React key, and the name the open
   * submenu is remembered by. `label` when absent.
   *
   * For lists whose labels can repeat. Two scenes called `Boss`, in two
   * folders, are two rows with one label: keyed by it, React reports a repeated
   * key, and hovering either would open the submenu of both.
   */
  key?: string;
  /** Dim text on the right, in the shortcut's column: a state or a reason. */
  detail?: string;
}

/** A `null` entry renders a separator, which keeps menu definitions terse. */
export type MenuEntry = MenuItem | null;

type MenuAlign = 'left' | 'right';
type MenuPlacement = 'below' | 'above';

interface MenuProps {
  items: readonly MenuEntry[];
  onClose: () => void;
  /** What the menu hangs from. A press on it is left to it. */
  anchor?: RefObject<HTMLElement | null>;
  /** Horizontal alignment against the box it hangs from. */
  align?: MenuAlign;
  /** Which side of that box the list opens on. */
  placement?: MenuPlacement;
  /** A submenu, drawn inside its parent: the parent listens for both. */
  nested?: boolean;
}

/**
 * The list itself: rows, separators, submenus, dismissal.
 *
 * Not exported. A list drawn where it was declared sat inside whatever declared
 * it, and the Scene menu, declared inside the menu bar, lost the pointer to the
 * toolbar's drag region — `Floating` tells that story. What leaves this file is
 * a placed menu: under an element (`DropdownMenu`, `MenuTrigger`) or at the
 * pointer (`ContextMenu`), both floating.
 *
 * Its own box opts out of the drag region, and not only the box it hangs from:
 * that box is no bigger than a point, a submenu hangs outside its parent, and
 * the region is made of each box's own rectangle.
 */
function Menu({
  items,
  onClose,
  anchor,
  align = 'left',
  placement = 'below',
  nested = false,
}: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);

  // Escape is the stack's, not the menu's: a menu opened from inside a dialog
  // has to close alone, and its own listener could not know it was not the only
  // thing open.
  useOverlay('popover', onClose, !nested);

  useEffect(() => {
    // A submenu is drawn inside its parent's element, so the parent's listener
    // already sees every press in it. One of its own took a press on the row it
    // hangs from for a press outside, and closed the whole menu.
    if (nested) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      // A press on the anchor is the anchor's to answer, as it is for
      // `Popover`. Closing here as well meant the title's own click opened the
      // menu again straight after this closed it, so a menu could not be
      // closed from its title.
      if (ref.current?.contains(target) || anchor?.current?.contains(target)) return;
      onClose();
    }
    // `capture` so the menu closes before the click lands on whatever is behind it.
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [anchor, nested, onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      className={`app-no-drag absolute min-w-56 border border-line-soft bg-surface-2 py-1 shadow-lg shadow-black/50 ${
        placement === 'above' ? 'bottom-full mb-1' : 'top-full mt-px'
      } ${align === 'right' ? 'right-0' : 'left-0'}`}
    >
      {items.map((item, index) => {
        if (item === null) return <div key={`separator-${index}`} className="my-1 h-px bg-line-soft" />;
        const id = item.key ?? item.label;
        return (
          <div
            key={id}
            className="group/row relative flex items-center"
            onPointerEnter={() => setOpenSubmenu(item.submenu ? id : null)}
          >
            <button
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                // A row that only opens a submenu must not dismiss the menu.
                if (item.submenu) {
                  setOpenSubmenu(id);
                  return;
                }
                onClose();
                item.onSelect?.();
              }}
              className="flex min-w-0 flex-1 items-center gap-3 px-3 py-1 text-left text-ink enabled:hover:bg-accent-dim disabled:text-ink-dim"
            >
              <span className="w-3 text-2xs text-ink-muted">{item.checked ? '✓' : ''}</span>
              {item.icon && <item.icon size={13} strokeWidth={1.75} className="shrink-0 text-ink-muted" />}
              <span className="flex-1 truncate whitespace-nowrap">{item.label}</span>
              {/* Neither capped nor cut. The list has no width of its own, so it
                  is as wide as its widest row: a long folder widens the menu
                  rather than cutting the name beside it short — and a folder cut
                  short would no longer tell two scenes of one name apart. */}
              {item.detail && <span className="whitespace-nowrap text-2xs text-ink-dim">{item.detail}</span>}
              {item.shortcut && (
                <span className="whitespace-nowrap text-2xs text-ink-dim">{item.shortcut}</span>
              )}
              {item.submenu && <ChevronRight size={11} className="shrink-0 text-ink-dim" />}
            </button>

            {item.submenu && openSubmenu === id && (
              <div className="absolute left-full top-0 z-10 -mt-1 pl-px">
                <Menu items={item.submenu} onClose={onClose} nested />
              </div>
            )}
            {item.onDelete && (
              <button
                type="button"
                title={`Delete ${item.label}`}
                // Deliberately does not close the menu: deleting several saved
                // items in a row is the normal case.
                onClick={(event) => {
                  event.stopPropagation();
                  item.onDelete?.();
                }}
                className="mr-2 rounded-sm p-1 text-ink-dim opacity-0 hover:bg-surface-3 hover:text-error group-hover/row:opacity-100"
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface ContextMenuProps {
  /** Viewport coordinates of the click that opened it. */
  x: number;
  y: number;
  items: readonly MenuEntry[];
  onClose: () => void;
}

/** Rough menu height used to decide whether to flip; exact enough to avoid a measure pass. */
const ESTIMATED_ROW_HEIGHT = 24;
const MENU_WIDTH = 224;

/** A menu at the pointer, for right-click. */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const height = items.length * ESTIMATED_ROW_HEIGHT;
  const flipUp = y + height > window.innerHeight;
  const left = Math.min(x, window.innerWidth - MENU_WIDTH);

  return (
    <Floating layer="menu" className="h-0 w-0" style={{ left, top: y }}>
      <Menu items={items} onClose={onClose} placement={flipUp ? 'above' : 'below'} />
    </Floating>
  );
}

interface DropdownMenuProps {
  /** What it hangs from: placed against it, and a press on it is left to it. */
  anchor: RefObject<HTMLElement | null>;
  items: readonly MenuEntry[];
  onClose: () => void;
  align?: MenuAlign;
  placement?: MenuPlacement;
  /**
   * For the box the list floats from — its type, say. Drawn inside its anchor,
   * a list took the anchor's; floating, it takes the body's.
   */
  className?: string;
}

/**
 * A menu hanging from an element: under it, or above it for a button at the
 * foot of a panel.
 *
 * It floats from a box as wide as the anchor and of no height, laid on the
 * anchor's bottom edge — its top edge when above. The list's own `top-full` or
 * `bottom-full`, `left-0` or `right-0`, then put it exactly where it hung when
 * it was drawn inside the anchor. Nothing is drawn until the anchor has been
 * measured, which happens before the first paint.
 */
export function DropdownMenu({
  anchor,
  items,
  onClose,
  align,
  placement = 'below',
  className = '',
}: DropdownMenuProps) {
  const rect = useAnchorRect(anchor);
  if (rect === null) return null;

  return (
    <Floating
      layer="menu"
      className={`h-0 ${className}`}
      style={{
        left: rect.left,
        width: rect.width,
        top: placement === 'above' ? rect.top : rect.bottom,
      }}
    >
      <Menu items={items} onClose={onClose} anchor={anchor} align={align} placement={placement} />
    </Floating>
  );
}

interface MenuTriggerProps {
  children: ReactNode;
  open: boolean;
  onToggle: () => void;
  /** Hovering a sibling trigger while any menu is open switches to it, like a native menu bar. */
  onHover: () => void;
  items: readonly MenuEntry[];
  onClose: () => void;
  align?: MenuAlign;
  className?: string;
  /** For the box its menu floats from; see `DropdownMenu`. */
  menuClassName?: string;
}

export function MenuTrigger({
  children,
  open,
  onToggle,
  onHover,
  items,
  onClose,
  align,
  className = '',
  menuClassName,
}: MenuTriggerProps) {
  // The wrapper rather than the button: the list used to hang from this box,
  // and anchoring to the same one keeps every menu exactly where it was.
  const anchor = useRef<HTMLDivElement>(null);

  return (
    <div ref={anchor}>
      <button
        type="button"
        onClick={onToggle}
        onPointerEnter={onHover}
        className={`px-2 py-1 ${open ? 'bg-accent-dim text-ink' : 'text-ink-muted hover:text-ink'} ${className}`}
      >
        {children}
      </button>
      {open && (
        <DropdownMenu
          anchor={anchor}
          items={items}
          onClose={onClose}
          align={align}
          className={menuClassName}
        />
      )}
    </div>
  );
}
