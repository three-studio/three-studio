import { AlertTriangle, CheckCircle2, ChevronRight, Info, X, XCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';

/**
 * A message with a severity, a title and optionally a way to act on it.
 *
 * Presentational and free-standing: the toast host is one place it appears,
 * but the same component is meant for anywhere a panel needs to say something —
 * a failed import in the Project panel, a scene that would not open.
 *
 * Conventions taken from the libraries that have argued about this longest
 * (Radix, Sonner, Carbon, Polaris):
 *
 *   - the title carries the message; details are opt-in, because a wall of
 *     text is skipped and a stack trace belongs behind a disclosure;
 *   - actions are verbs, and there are at most two — a third is a dialog;
 *   - errors and warnings announce themselves assertively, information does
 *     not, so a success does not interrupt a screen reader mid-sentence.
 */
export type AlertKind = 'info' | 'success' | 'warning' | 'error' | 'progress';

export interface AlertAction {
  label: string;
  onClick: () => void;
  /** Draws attention to the one action worth taking. */
  primary?: boolean;
}

export interface AlertProps {
  kind: AlertKind;
  title: string;
  /** One line under the title. Longer than that belongs in `details`. */
  description?: string;
  /** Behind a "More details" disclosure: a stack, a list of skipped files. */
  details?: ReactNode;
  /** Open the disclosure straight away, for details that are the point. */
  detailsOpen?: boolean;
  actions?: readonly AlertAction[];
  /** `0..1` draws a determinate bar; `null` an indeterminate one. */
  progress?: number | null;
  onDismiss?: () => void;
}

const STYLES: Record<AlertKind, { icon: typeof Info; accent: string; ring: string }> = {
  info: { icon: Info, accent: 'text-accent', ring: 'border-line-soft' },
  success: { icon: CheckCircle2, accent: 'text-ok', ring: 'border-ok/40' },
  warning: { icon: AlertTriangle, accent: 'text-warn', ring: 'border-warn/40' },
  error: { icon: XCircle, accent: 'text-error', ring: 'border-error/50' },
  progress: { icon: Info, accent: 'text-accent', ring: 'border-line-soft' },
};

export function Alert({
  kind,
  title,
  description,
  details,
  detailsOpen = false,
  actions,
  progress,
  onDismiss,
}: AlertProps) {
  const [expanded, setExpanded] = useState(detailsOpen);
  const { icon: Icon, accent, ring } = STYLES[kind];
  const severe = kind === 'error' || kind === 'warning';

  return (
    <div
      // Assertive only when something is wrong: a success that interrupts a
      // screen reader mid-sentence is worse than one read a moment later.
      role={severe ? 'alert' : 'status'}
      aria-live={severe ? 'assertive' : 'polite'}
      className={`w-80 overflow-hidden rounded-sm border ${ring} bg-surface-2 shadow-lg shadow-black/40`}
    >
      <div className="flex gap-2 p-2.5">
        {kind === 'progress' ? (
          <span
            className={`mt-px h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent ${accent}`}
            aria-hidden
          />
        ) : (
          <Icon size={13} className={`mt-px shrink-0 ${accent}`} aria-hidden />
        )}

        <div className="min-w-0 flex-1">
          <p className="text-2xs font-medium text-ink">{title}</p>
          {description && <p className="mt-0.5 text-2xs text-ink-muted">{description}</p>}

          {progress !== undefined && (
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-0">
              <div
                className={`h-full rounded-full bg-accent ${progress === null ? 'w-1/3 animate-pulse' : ''}`}
                style={progress === null ? undefined : { width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          )}

          {details !== undefined && (
            <>
              <button
                type="button"
                onClick={() => setExpanded((open) => !open)}
                aria-expanded={expanded}
                className="mt-1.5 flex items-center gap-0.5 text-2xs text-ink-dim hover:text-ink"
              >
                <ChevronRight
                  size={10}
                  className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
                />
                More details
              </button>
              {expanded && (
                <div className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-xs bg-surface-0 p-1.5 font-mono text-2xs text-ink-muted">
                  {details}
                </div>
              )}
            </>
          )}

          {actions && actions.length > 0 && (
            <div className="mt-2 flex gap-1.5">
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={action.onClick}
                  className={`rounded-xs px-2 py-1 text-2xs ${
                    action.primary
                      ? 'bg-accent-dim text-ink hover:bg-accent/40'
                      : 'text-ink-muted hover:bg-surface-3 hover:text-ink'
                  }`}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {onDismiss && (
          <button
            type="button"
            title="Dismiss"
            onClick={onDismiss}
            className="-mr-0.5 -mt-0.5 h-4 w-4 shrink-0 rounded-xs text-ink-dim hover:bg-surface-3 hover:text-ink"
          >
            <X size={11} className="mx-auto" />
          </button>
        )}
      </div>
    </div>
  );
}
