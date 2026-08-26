import { useEffect, useState } from 'react';
import { useOverlay } from '../state/overlayStore';
import { useDialogStore } from '../state/dialogStore';

/**
 * The single text prompt for the whole editor, driven by `askForText`.
 *
 * Rendered once near the root so any part of the UI can ask for a name without
 * owning a dialog of its own.
 */
export function PromptDialog() {
  return (
    <>
      <TextPrompt />
      <ConfirmPrompt />
    </>
  );
}

function TextPrompt() {
  const prompt = useDialogStore((s) => s.prompt);
  const submit = useDialogStore((s) => s.submit);
  const cancel = useDialogStore((s) => s.cancel);

  const [value, setValue] = useState('');

  useEffect(() => {
    setValue(prompt?.defaultValue ?? '');
  }, [prompt]);

  useOverlay('modal', cancel, prompt !== null);

  if (!prompt) return null;

  const error = prompt.validate?.(value) ?? null;
  const canConfirm = value.trim() !== '' && error === null;

  return (
    <div
      className="fixed inset-0 z-prompt flex items-start justify-center bg-black/50 pt-32"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) cancel();
      }}
    >
      <form
        className="w-80 rounded-sm border border-line-soft bg-surface-2 p-3 shadow-xl shadow-black/50"
        onSubmit={(event) => {
          event.preventDefault();
          if (canConfirm) submit(value.trim());
        }}
      >
        <h2 className="mb-2 text-ink">{prompt.title}</h2>

        {prompt.label && <label className="mb-1 block text-2xs text-ink-muted">{prompt.label}</label>}
        <input
          ref={(element) => element?.focus({ preventScroll: true })}
          value={value}
          placeholder={prompt.placeholder}
          onChange={(event) => setValue(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          className="w-full rounded-sm bg-surface-3 px-2 py-1.5 text-ink outline-none focus:ring-1 focus:ring-accent"
        />

        {error !== null && <p className="mt-1 text-2xs text-error">{error}</p>}

        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={cancel}
            className="rounded-sm px-3 py-1.5 text-2xs text-ink-muted hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canConfirm}
            className="rounded-sm bg-accent px-3 py-1.5 text-2xs font-medium text-white hover:bg-accent/85 disabled:opacity-40"
          >
            {prompt.confirmLabel ?? 'OK'}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * The yes-or-no counterpart, for actions no undo can take back.
 *
 * Cancel is the default focus and Escape cancels: the dangerous button should
 * never be the one a reflex press lands on.
 */
function ConfirmPrompt() {
  const confirm = useDialogStore((s) => s.confirm);
  const accept = useDialogStore((s) => s.accept);
  const cancel = useDialogStore((s) => s.cancel);

  useOverlay('modal', cancel, confirm !== null);

  if (!confirm) return null;

  return (
    <div
      className="fixed inset-0 z-prompt flex items-start justify-center bg-black/50 pt-32"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) cancel();
      }}
    >
      <div className="w-96 rounded-sm border border-line-soft bg-surface-2 p-3 shadow-xl shadow-black/50">
        <h2 className="mb-1.5 text-ink">{confirm.title}</h2>
        <p className="text-2xs leading-relaxed text-ink-muted">{confirm.message}</p>

        {confirm.details && confirm.details.length > 0 && (
          <ul className="mt-2 max-h-40 overflow-auto rounded-sm bg-surface-1 p-2 text-2xs text-ink-dim">
            {/* Indexed: two objects can carry the same name, and often do. */}
            {confirm.details.map((line, index) => (
              <li key={`${index}:${line}`} className="truncate py-0.5">
                {line}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            ref={(element) => element?.focus({ preventScroll: true })}
            onClick={cancel}
            className="rounded-sm px-3 py-1.5 text-2xs text-ink-muted hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={accept}
            className={`rounded-sm px-3 py-1.5 text-2xs font-medium text-white ${
              confirm.destructive ? 'bg-error hover:bg-error/85' : 'bg-accent hover:bg-accent/85'
            }`}
          >
            {confirm.confirmLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
