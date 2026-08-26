import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** Named in the message, so a blank region says which one it was. */
  area: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches a render error and says so, instead of leaving a hole.
 *
 * Without one, React unmounts the failing subtree and never returns to it: the
 * menu bar simply vanishes, nothing is logged where the user can see it, and
 * the only clue is that part of the window is missing. That happened during
 * development and cost real time to diagnose.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.area}] render failed:`, error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-full min-h-8 w-full items-center gap-2 bg-error/15 px-3 py-1 text-2xs text-error">
        <span className="font-medium">{this.props.area} failed to render.</span>
        <span className="min-w-0 flex-1 truncate text-ink-muted" data-selectable>
          {error.message}
        </span>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="rounded-sm bg-surface-3 px-2 py-0.5 text-ink hover:bg-surface-4"
        >
          Retry
        </button>
      </div>
    );
  }
}
