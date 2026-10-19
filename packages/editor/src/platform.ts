import type { Platform, StudioBridge } from '@three-studio/core';

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
 * The platform, read when asked rather than when this module loads: a test
 * stubs the bridge after this module has loaded, the way the device commands
 * read it when they need it.
 */
function currentPlatform(): Platform | undefined {
  return typeof window === 'undefined'
    ? undefined
    : (window.studio as StudioBridge | undefined)?.platform;
}

/**
 * The words for showing a file where it lives, in the platform's own: `Show in
 * Finder`, `Show in Explorer`, and `Show in File Manager` where the desktop
 * decides which one opens.
 *
 * Every menu entry, toast button and tooltip that does this reads it here. They
 * said `Show in Finder` on every platform, beside two tooltips that said
 * `Reveal in file manager` for the same gesture.
 */
export function showInFileManagerLabel(platform = currentPlatform()): string {
  switch (platform) {
    case 'darwin':
      return 'Show in Finder';
    case 'win32':
      return 'Show in Explorer';
    default:
      return 'Show in File Manager';
  }
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
