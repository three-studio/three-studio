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
