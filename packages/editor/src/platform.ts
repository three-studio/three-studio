/**
 * The editor also has to render outside Electron (storybook-style harnesses,
 * and eventually a browser build), so the bridge is treated as optional here
 * even though it is always present in the desktop app.
 */
const bridge = typeof window === 'undefined' ? undefined : window.studio;

export const isMac = bridge?.platform === 'darwin';

/** Modifier prefix for shortcut hints: `⌘S` on macOS, `Ctrl+S` elsewhere. */
export const modKey = isMac ? '⌘' : 'Ctrl+';
export const shiftKey = isMac ? '⇧' : 'Shift+';

/**
 * True when the platform's primary modifier is held (Cmd on macOS, Ctrl
 * elsewhere). Structurally typed so React's synthetic events pass too.
 */
export function hasModifier(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return isMac ? event.metaKey : event.ctrlKey;
}

/**
 * The event landed in a text field, so the user is writing rather than acting.
 *
 * Both the shortcut layer and the fly camera have to ask this, and they have to
 * agree: a divergence means a key that switches a tool while it also types a
 * letter. It lives here rather than in either of them because `useShortcuts`
 * reaches for the viewport and the viewport would then reach back.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  );
}
