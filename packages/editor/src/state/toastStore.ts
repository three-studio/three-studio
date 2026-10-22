import { create } from 'zustand';
import type { AlertProps } from '../ui/Alert';

/**
 * The editor's transient messages.
 *
 * Rules taken from the libraries that have thought about this hardest (Sonner,
 * Carbon, Polaris, Fluent):
 *
 *   - a toast is never the only way to reach something. Its actions are
 *     shortcuts, and the same thing must be reachable from a menu or a panel;
 *   - information and success dismiss themselves; warnings and errors do not.
 *     Something went wrong is not a message to time out from under someone;
 *   - a running task holds its toast until it finishes, then becomes the
 *     result rather than adding a second one;
 *   - the stack is capped. Twenty toasts is a log, and we have a Console.
 */

export type ToastInput = Omit<AlertProps, 'onDismiss'> & {
  /**
   * Milliseconds before it disappears. Defaults to 5s for `info` and
   * `success`, and to never for anything else.
   */
  duration?: number | null;
};

export interface Toast extends ToastInput {
  id: string;
  createdAt: number;
}

/** Older ones fall off the bottom; the newest is always the one you can read. */
const MAX_VISIBLE = 5;

const DEFAULT_DURATION_MS = 5000;

interface ToastState {
  toasts: Toast[];
  /** Adds a toast and returns its id, so a running task can update it. */
  push: (toast: ToastInput) => string;
  /** Replaces the fields given; used to drive progress and then the result. */
  update: (id: string, toast: Partial<ToastInput>) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

function defaultDuration(toast: ToastInput): number | null {
  if (toast.duration !== undefined) return toast.duration;
  // A task in flight has no business expiring, and a failure has to be read.
  if (toast.kind === 'progress' || toast.kind === 'error' || toast.kind === 'warning') return null;
  return DEFAULT_DURATION_MS;
}

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],

  push: (toast) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const next = [...get().toasts, { ...toast, id, createdAt: Date.now() }];
    set({ toasts: next.slice(-MAX_VISIBLE) });
    return id;
  },

  update: (id, toast) =>
    set((state) => ({
      toasts: state.toasts.map((existing) =>
        existing.id === id
          ? // `createdAt` is refreshed so a toast that becomes a result starts
            // its dismissal countdown then, not when the task began.
            { ...existing, ...toast, createdAt: Date.now() }
          : existing,
      ),
    })),

  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

/** Convenience for the common case: one message, no follow-up. */
export function notify(toast: ToastInput): string {
  return useToastStore.getState().push(toast);
}

/**
 * One toast at a time for one subject. `show` replaces the slot's toast where
 * it stands, or pushes a new one when the person has dismissed it; it never
 * stacks a second.
 *
 * For a message that can be said again before it has been read: a failed Play
 * pressed again, a gesture refused at each try. Stacked, the copies say nothing
 * more than one, and they push everything else off the five.
 *
 * Whether the toast is up is read from the store, never remembered: a toast the
 * person closed, or that Clear all or the cap took, is gone, and updating it
 * would say nothing to anyone. A replacement goes through `update`, which keeps
 * the fields the new toast leaves out — so callers give the whole toast.
 */
export function toastSlot(): { show(toast: ToastInput): void; dismiss(): void } {
  let id: string | null = null;
  return {
    show(toast) {
      const store = useToastStore.getState();
      if (id !== null && store.toasts.some((shown) => shown.id === id)) store.update(id, toast);
      else id = store.push(toast);
    },
    dismiss() {
      if (id !== null) useToastStore.getState().dismiss(id);
      id = null;
    },
  };
}

export { defaultDuration };
