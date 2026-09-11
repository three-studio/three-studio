import { ChevronDown, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { Menu, type MenuEntry } from './Menu';

interface ToolButtonProps {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
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
  active = false,
  disabled = false,
  activeClassName = 'bg-accent-dim text-ink',
  onClick,
}: ToolButtonProps) {
  return (
    <button
      type="button"
      title={shortcut ? `${label}  (${shortcut})` : label}
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
  icon: Icon,
  shortcut,
  active = false,
  disabled = false,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={shortcut ? `${label}  (${shortcut})` : label}
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
  /** Appended to the tooltip: what this value actually does. */
  hint?: string;
  icon: LucideIcon;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  items: readonly MenuEntry[];
  onCycle: () => void;
}) {
  const [open, setOpen] = useState(false);

  const title = [hint ? `${label} — ${hint}` : label, shortcut ? `  (${shortcut})` : ''].join('');
  const tone = active
    ? 'bg-accent-dim text-ink'
    : 'text-ink-muted enabled:hover:bg-surface-3 enabled:hover:text-ink';

  return (
    <div className="relative flex items-center">
      <button
        type="button"
        title={title}
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
        title={`${label}: pick a mode`}
        aria-label={`${label}: pick a mode`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className={`flex h-7 items-center rounded-r-sm pl-0.5 pr-1 transition-colors ${tone} disabled:text-ink-dim disabled:hover:bg-transparent`}
      >
        <ChevronDown size={11} strokeWidth={2} />
      </button>
      {open && <Menu items={items} onClose={() => setOpen(false)} />}
    </div>
  );
}

export function ToolbarSeparator() {
  return <div className="mx-1.5 h-5 w-px bg-line-soft" />;
}
