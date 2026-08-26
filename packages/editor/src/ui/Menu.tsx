import { ChevronRight, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useOverlay } from '../state/overlayStore';

export interface MenuItem {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  checked?: boolean;
  onSelect?: () => void;
  /** Renders a delete affordance on the row; the menu stays open afterwards. */
  onDelete?: () => void;
  /** Nested entries, opened to the side on hover. */
  submenu?: readonly MenuEntry[];
}

/** A `null` entry renders a separator, which keeps menu definitions terse. */
export type MenuEntry = MenuItem | null;

interface MenuProps {
  items: readonly MenuEntry[];
  onClose: () => void;
  /** Horizontal alignment relative to the trigger. */
  align?: 'left' | 'right';
  /** Which side of the trigger the list opens on. */
  placement?: 'below' | 'above';
}

/**
 * Dropdown body. Positioning is the caller's job (the trigger must be
 * `relative`); this component only owns the list, dismissal and item chrome.
 */
export function Menu({ items, onClose, align = 'left', placement = 'below' }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);

  // Escape is the stack's, not the menu's: a menu opened from inside a dialog
  // has to close alone, and its own listener could not know it was not the only
  // thing open.
  useOverlay('popover', onClose);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) onClose();
    }
    // `capture` so the menu closes before the click lands on whatever is behind it.
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      className={`absolute z-menu min-w-56 border border-line-soft bg-surface-2 py-1 shadow-lg shadow-black/50 ${
        placement === 'above' ? 'bottom-full mb-1' : 'top-full mt-px'
      } ${align === 'right' ? 'right-0' : 'left-0'}`}
    >
      {items.map((item, index) =>
        item === null ? (
          <div key={`separator-${index}`} className="my-1 h-px bg-line-soft" />
        ) : (
          <div
            key={item.label}
            className="group/row relative flex items-center"
            onPointerEnter={() => setOpenSubmenu(item.submenu ? item.label : null)}
          >
            <button
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                // A row that only opens a submenu must not dismiss the menu.
                if (item.submenu) {
                  setOpenSubmenu(item.label);
                  return;
                }
                onClose();
                item.onSelect?.();
              }}
              className="flex min-w-0 flex-1 items-center gap-3 px-3 py-1 text-left text-ink enabled:hover:bg-accent-dim disabled:text-ink-dim"
            >
              <span className="w-3 text-2xs text-ink-muted">{item.checked ? '✓' : ''}</span>
              <span className="flex-1 truncate whitespace-nowrap">{item.label}</span>
              {item.shortcut && (
                <span className="whitespace-nowrap text-2xs text-ink-dim">{item.shortcut}</span>
              )}
              {item.submenu && <ChevronRight size={11} className="shrink-0 text-ink-dim" />}
            </button>

            {item.submenu && openSubmenu === item.label && (
              <div className="absolute left-full top-0 z-10 -mt-1 pl-px">
                <Menu items={item.submenu} onClose={onClose} />
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
        ),
      )}
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

/**
 * A menu at the pointer, for right-click.
 *
 * Rendered into `document.body` rather than in place. `position: fixed` is
 * relative to the viewport only while no ancestor has a transform — and
 * dockview positions its panels with one, which made the menu appear offset by
 * the panel's own origin. A portal leaves that ancestor chain entirely, and
 * incidentally escapes the panel's scroll container too.
 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const height = items.length * ESTIMATED_ROW_HEIGHT;
  const flipUp = y + height > window.innerHeight;
  const left = Math.min(x, window.innerWidth - MENU_WIDTH);

  return createPortal(
    <div className="fixed z-menu h-0 w-0" style={{ left, top: y }}>
      <Menu items={items} onClose={onClose} placement={flipUp ? 'above' : 'below'} />
    </div>,
    document.body,
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
  align?: 'left' | 'right';
  className?: string;
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
}: MenuTriggerProps) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        onPointerEnter={onHover}
        className={`px-2 py-1 ${open ? 'bg-accent-dim text-ink' : 'text-ink-muted hover:text-ink'} ${className}`}
      >
        {children}
      </button>
      {open && <Menu items={items} onClose={onClose} align={align} />}
    </div>
  );
}
