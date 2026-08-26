import type { LucideIcon } from 'lucide-react';

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

/** Labelled variant for mode switches that read better as words (Global/Local). */
export function ToolToggle({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-7 items-center gap-1.5 rounded-sm px-2 text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink"
    >
      <Icon size={13} strokeWidth={1.75} />
      <span className="text-2xs">{label}</span>
    </button>
  );
}

export function ToolbarSeparator() {
  return <div className="mx-1.5 h-5 w-px bg-line-soft" />;
}
