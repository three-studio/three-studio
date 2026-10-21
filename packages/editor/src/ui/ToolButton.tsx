import { ChevronDown, type LucideIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { DropdownMenu, type MenuEntry } from './Menu';
import { tooltip } from './Tooltip';

interface ToolButtonProps {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  /** The tooltip's second line: why the button is off, say. */
  hint?: string;
  active?: boolean;
  disabled?: boolean;
  /** Overrides the icon colour when active — used for the green Play button. */
  activeClassName?: string;
  onClick?: () => void;
}

export function ToolButton({
  icon: Icon,
  label,
  shortcut,
  hint,
  active = false,
  disabled = false,
  activeClassName = 'bg-accent-dim text-ink',
  onClick,
}: ToolButtonProps) {
  return (
    <button
      type="button"
      {...tooltip(label, { keys: shortcut, hint })}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-sm transition-colors ${
        active ? activeClassName : 'text-ink-muted enabled:hover:bg-surface-3 enabled:hover:text-ink'
      } disabled:text-ink-dim disabled:hover:bg-transparent`}
    >
      <Icon size={15} strokeWidth={1.75} />
    </button>
  );
}

/**
 * Labelled variant for mode switches that read better as words (Global/Local).
 *
 * It carries the same `active`, `disabled` and `shortcut` as `ToolButton`, and
 * that is not symmetry for its own sake. A switch whose only state is the word
 * printed on it reads as a label rather than as a control: the author of this
 * editor spent a session convinced the rotation gizmo was broken, when it was
 * merely in Global — the mode this button was quietly announcing all along.
 */
export function ToolToggle({
  label,
  hint,
  icon: Icon,
  shortcut,
  active = false,
  disabled = false,
  onClick,
}: {
  label: string;
  /** The tooltip's second line: what this value does. */
  hint?: string;
  icon: LucideIcon;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      {...tooltip(label, { keys: shortcut, hint })}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-7 items-center gap-1.5 rounded-sm px-2 transition-colors ${
        active
          ? 'bg-accent-dim text-ink'
          : 'text-ink-muted enabled:hover:bg-surface-3 enabled:hover:text-ink'
      } disabled:text-ink-dim disabled:hover:bg-transparent`}
    >
      <Icon size={13} strokeWidth={1.75} />
      <span className="text-2xs">{label}</span>
    </button>
  );
}

/**
 * How a split button's halves look, on and off. Exported so that every split
 * button in the toolbar takes the same two looks rather than a copy of them.
 */
export function toolTone(active: boolean): string {
  return active
    ? 'bg-accent-dim text-ink'
    : 'text-ink-muted enabled:hover:bg-surface-3 enabled:hover:text-ink';
}

/**
 * Split button: the body steps to the next value, the chevron lists them all.
 *
 * Both halves earn their place and neither replaces the other. Stepping is the
 * gesture for a switch someone flips twenty times an hour and it needs no aim;
 * the list is the only thing that makes a *third* value discoverable, because a
 * cycle can never show more than the one that comes next.
 *
 * The two are separate `<button>`s rather than one with a hit test, so the
 * chevron is reachable by keyboard and reads as its own control to a screen
 * reader. They share the active and disabled treatment so they still look like
 * one object.
 */
export function ToolSplitToggle({
  label,
  hint,
  icon: Icon,
  shortcut,
  active = false,
  disabled = false,
  items,
  onCycle,
}: {
  label: string;
  /** The tooltip's second line: what this value actually does. */
  hint?: string;
  icon: LucideIcon;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  items: readonly MenuEntry[];
  onCycle: () => void;
}) {
  const [open, setOpen] = useState(false);
  // The whole split button, as `DeviceButton`'s popover hangs from: a press on
  // the body steps the value and leaves the list open, its tick following.
  const anchor = useRef<HTMLDivElement>(null);

  const tone = toolTone(active);

  return (
    <div ref={anchor} className="flex items-center">
      <button
        type="button"
        {...tooltip(label, { keys: shortcut, hint })}
        aria-pressed={active}
        disabled={disabled}
        onClick={onCycle}
        className={`flex h-7 items-center gap-1.5 rounded-l-sm py-0 pl-2 pr-1.5 transition-colors ${tone} disabled:text-ink-dim disabled:hover:bg-transparent`}
      >
        <Icon size={13} strokeWidth={1.75} />
        <span className="text-2xs">{label}</span>
      </button>
      <button
        type="button"
        {...tooltip(`${label}: pick a mode`)}
        aria-label={`${label}: pick a mode`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className={`flex h-7 items-center rounded-r-sm pl-0.5 pr-1 transition-colors ${tone} disabled:text-ink-dim disabled:hover:bg-transparent`}
      >
        <ChevronDown size={11} strokeWidth={2} />
      </button>
      {open && <DropdownMenu anchor={anchor} items={items} onClose={() => setOpen(false)} />}
    </div>
  );
}

export function ToolbarSeparator() {
  return <div className="mx-1.5 h-5 w-px bg-line-soft" />;
}
