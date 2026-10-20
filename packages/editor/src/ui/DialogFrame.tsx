import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useOverlay } from '../state/overlayStore';
import { Floating } from './Floating';

interface DialogFrameProps {
  title: string;
  onClose: () => void;
  /** The body, laid out by the caller: a section list, a file list, anything. */
  children: ReactNode;
  /** Buttons along the bottom right. */
  footer?: ReactNode;
  /** Sizing for the panel itself, when the default is the wrong shape. */
  panelClassName?: string;
  /**
   * Grows to the window instead of to a fixed size, keeping the gutter.
   *
   * A flag rather than something the caller expresses in `panelClassName`,
   * because the gutter is on the backdrop and the panel class cannot reach it —
   * and a dialog that fills the window still has to read as a dialog, so it
   * keeps its rounding, its outline, and the editor showing around it.
   */
  fillsWindow?: boolean;
}

const DEFAULT_PANEL = 'h-full max-h-[760px] w-full max-w-[1000px]';
const FILLING_PANEL = 'h-full w-full';
const PANEL_CHROME = 'rounded-sm border border-line-soft shadow-2xl shadow-black/60';

/**
 * The shell every large dialog shares: the backdrop, the title bar, the footer,
 * Escape, and click-outside-to-close.
 *
 * Drawn by `Floating`, scrim included. The modal owns the window until it is
 * answered, so the scrim covers the menu bar and the toolbar as well, and a
 * press anywhere on it closes the dialog — over the chrome too, where a drag
 * region underneath used to take the press and move the window.
 *
 * It holds no state and decides nothing about the body. That is what lets the
 * settings dialogs put a section list down the left and the import dialog put a
 * list of files being imported there instead.
 */
export function DialogFrame({
  title,
  onClose,
  children,
  footer,
  panelClassName = DEFAULT_PANEL,
  fillsWindow = false,
}: DialogFrameProps) {
  // Escape is not handled here. Every surface used to capture it on `document`
  // for itself, so two open at once both closed, and the editor's own Escape
  // cleared the selection behind them as well. It now belongs to whatever is on
  // top of the stack, which is the only place that can know.
  useOverlay('modal', onClose);

  return (
    <Floating
      layer="dialog"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className={`inset-0 flex items-center justify-center bg-black/50 ${
        fillsWindow ? 'p-9' : 'p-8'
      }`}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`flex flex-col overflow-hidden bg-surface-1 ${PANEL_CHROME} ${
          fillsWindow ? FILLING_PANEL : panelClassName
        }`}
      >
        <header className="flex h-10 shrink-0 items-center border-b border-line px-3">
          <h2 className="flex-1 text-2xs font-medium text-ink">{title}</h2>
          <button
            type="button"
            title="Close"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-sm text-ink-dim hover:bg-surface-3 hover:text-ink"
          >
            <X size={13} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1">{children}</div>

        {footer && (
          <footer className="flex h-12 shrink-0 items-center justify-end gap-2 border-t border-line px-3">
            {footer}
          </footer>
        )}
      </div>
    </Floating>
  );
}

/** One labelled control, laid out like the inspector so the two read alike. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="mb-2.5 flex items-start gap-3">
      <span className="w-44 shrink-0 pt-1 text-2xs text-ink-muted">
        {label}
        {hint && <span className="mt-0.5 block text-2xs text-ink-dim">{hint}</span>}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}
