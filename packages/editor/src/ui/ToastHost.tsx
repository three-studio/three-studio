import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { defaultDuration, useToastStore, type Toast } from '../state/toastStore';
import { Alert } from './Alert';

/**
 * Where transient messages appear: bottom right, newest at the bottom.
 *
 * Rendered into `document.body`. `position: fixed` is relative to the viewport
 * only while no ancestor carries a transform, and dockview gives its panels
 * one — the same trap the context menu and the asset preview fell into.
 */
export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  const clear = useToastStore((s) => s.clear);
  const [paused, setPaused] = useState(false);

  if (toasts.length === 0) return null;

  return createPortal(
    <div
      // Hovering the stack stops the clock: reading a message should not be a
      // race against it, and reaching for its action even less so.
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      className="pointer-events-none fixed bottom-3 right-3 z-toast flex flex-col items-end gap-2"
    >
      {toasts.length > 1 && (
        <button
          type="button"
          onClick={clear}
          className="pointer-events-auto rounded-xs bg-surface-2/90 px-2 py-1 text-2xs text-ink-dim shadow-lg shadow-black/40 hover:text-ink"
        >
          Clear all
        </button>
      )}

      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <TimedToast toast={toast} paused={paused} onDismiss={() => dismiss(toast.id)} />
        </div>
      ))}
    </div>,
    document.body,
  );
}

function TimedToast({
  toast,
  paused,
  onDismiss,
}: {
  toast: Toast;
  paused: boolean;
  onDismiss: () => void;
}) {
  const duration = defaultDuration(toast);
  // Read through a ref so the timer is not restarted every time the pointer
  // moves; only a real change of toast or of pause state should reset it.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (duration === null || paused) return;
    const remaining = Math.max(0, duration - (Date.now() - toast.createdAt));
    const timer = setTimeout(() => dismissRef.current(), remaining);
    return () => clearTimeout(timer);
  }, [duration, paused, toast.createdAt]);

  return <Alert {...toast} onDismiss={onDismiss} />;
}
