import { Pause, Play, type LucideIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { useEditorStore } from '../state/editorStore';
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
 * The Viewport's header strip, which the edit tools and the play bar share.
 *
 * One strip, because its height is where the stage starts. A play bar of any
 * other height would move the stage at the press of Play — both canvases
 * resized, the edit image held under Starting… among them, the renderer's frame
 * buffer retired, and the game's first aspect read from a box about to change.
 */
export function ViewHeader({ className = '', ...props }: ComponentProps<'div'>) {
  return (
    // `overflow-clip` rather than `hidden`, for the reason `#root` gives in
    // `styles.css`: a panel too narrow for the strip cuts its last buttons off
    // instead of becoming a box that focusing a button can scroll.
    <div
      {...props}
      className={`flex h-8 shrink-0 items-center gap-0.5 overflow-clip bg-surface-1 px-1 ${className}`}
    />
  );
}

/**
 * The game's state as a glyph: ▶ in the play green while it starts or runs,
 * ❚❚ in the pause amber while paused.
 *
 * Read from the play state, as the editor's tint is, so that the two say Pause
 * together from the moment it is pressed — before the game's first frame too.
 */
export function PlayGlyph() {
  const paused = useEditorStore((s) => s.playState === 'paused');
  const Glyph = paused ? Pause : Play;
  return <Glyph size={12} aria-hidden className={`shrink-0 fill-current ${paused ? 'text-pause' : 'text-play'}`} />;
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
      <PlayGlyph />
      <span className="truncate">{STOP_TO_EDIT}</span>
    </div>
  );
}
