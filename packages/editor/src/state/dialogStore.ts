import { create } from 'zustand';

export interface TextPromptOptions {
  title: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** Return a message to block confirmation, or `null` to allow it. */
  validate?: (value: string) => string | null;
}

interface PendingPrompt extends TextPromptOptions {
  resolve: (value: string | null) => void;
}

export interface ConfirmOptions {
  title: string;
  /** What is about to happen, in the terms the user thinks in. */
  message: string;
  /** Lines of detail — what would break, what would be lost. */
  details?: readonly string[];
  confirmLabel?: string;
  /** Colours the confirm button as a destructive action. */
  destructive?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

interface DialogState {
  prompt: PendingPrompt | null;
  confirm: PendingConfirm | null;
  submit: (value: string) => void;
  accept: () => void;
  cancel: () => void;
}

export const useDialogStore = create<DialogState>()((set, get) => ({
  prompt: null,
  confirm: null,

  submit: (value) => {
    get().prompt?.resolve(value);
    set({ prompt: null });
  },
  accept: () => {
    get().confirm?.resolve(true);
    set({ confirm: null });
  },
  cancel: () => {
    get().prompt?.resolve(null);
    get().confirm?.resolve(false);
    set({ prompt: null, confirm: null });
  },
}));

/**
 * Asks a yes-or-no question, for something that cannot be undone.
 *
 * Deleting an asset is one: the file leaves the project, and no amount of
 * Cmd+Z brings it back. Dismissing without choosing is a no.
 */
export function askToConfirm(options: ConfirmOptions): Promise<boolean> {
  const state = useDialogStore.getState();
  state.confirm?.resolve(false);

  return new Promise((resolve) => {
    useDialogStore.setState({ confirm: { ...options, resolve } });
  });
}

/**
 * Asks the user for a line of text.
 *
 * Electron does not implement `window.prompt` — it throws "prompt() is not
 * supported" — so the browser built-in is not an option, and using it silently
 * broke the buttons that did. Resolves to `null` when cancelled.
 */
export function askForText(options: TextPromptOptions): Promise<string | null> {
  const state = useDialogStore.getState();
  // A second request replaces the first rather than stacking dialogs.
  state.prompt?.resolve(null);

  return new Promise((resolve) => {
    useDialogStore.setState({ prompt: { ...options, resolve } });
  });
}
