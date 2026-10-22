import { Play, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { STOP_TO_EDIT, useSceneLocked } from '../state/sceneLock';

/** Panel body with the standard background and scroll behaviour. */
export function PanelBody({ children }: { children: ReactNode }) {
  return <div className="h-full w-full overflow-auto bg-surface-1">{children}</div>;
}

/**
 * Placeholder for panels whose feature has not landed yet. Naming the milestone
 * makes an empty panel read as "not built" rather than "broken".
 */
export function PanelPlaceholder({
  icon: Icon,
  title,
  milestone,
}: {
  icon: LucideIcon;
  title: string;
  milestone: string;
}) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-surface-1 text-ink-dim">
      <Icon size={28} strokeWidth={1.25} />
      <p className="text-ink-muted">{title}</p>
      <p className="text-2xs">{milestone}</p>
    </div>
  );
}

/** Compact header strip used by panels that need their own search / filter row. */
export function PanelToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-7 shrink-0 items-center gap-1 border-b border-line bg-surface-2 px-1.5">
      {children}
    </div>
  );
}

/**
 * Says, at the top of a panel the game has made read-only, why it cannot edit
 * and what gives the editing back. Nothing while stopped.
 *
 * A line above the content rather than a placeholder in its place: during Play
 * the Hierarchy and the Inspector still select, fold and show every value, and
 * the scene being played is exactly what someone wants to read.
 */
export function StopToEditStrip() {
  const locked = useSceneLocked();
  if (!locked) return null;
  return (
    <div
      // Stable hook for automated checks.
      data-scene-locked
      className="flex h-6 shrink-0 items-center gap-1.5 border-b border-line bg-surface-2 px-2 text-2xs text-ink-muted"
    >
      <Play size={11} className="shrink-0 fill-current text-play" />
      <span className="truncate">{STOP_TO_EDIT}</span>
    </div>
  );
}
