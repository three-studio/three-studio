import type { LucideIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

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
