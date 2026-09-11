export const LAYOUT_PREFERENCES_VERSION = 1;

/**
 * A dock arrangement, as the editor serialises it.
 *
 * Opaque on purpose: the shape belongs to the dock library, and `@three-studio/core`
 * has no business depending on the editor's UI toolkit just to carry it to
 * disk.
 */
export type SerializedLayout = unknown;

/** A layout the user saved under a name. */
export interface LayoutTemplateRecord {
  id: string;
  name: string;
  layout: SerializedLayout;
  savedAt: number;
}

/**
 * Window layout preferences, stored per user rather than per project.
 *
 * These live in the app's data directory next to the recent projects list, not
 * in the renderer's localStorage: they are application preferences, they should
 * survive clearing browsing data, and a user should be able to find and copy
 * them between machines.
 */
export interface LayoutPreferences {
  version: number;
  /** The arrangement in use, restored on the next launch. */
  working: SerializedLayout | null;
  templates: LayoutTemplateRecord[];
}

export function emptyLayoutPreferences(): LayoutPreferences {
  return { version: LAYOUT_PREFERENCES_VERSION, working: null, templates: [] };
}

export const SHORTCUT_PREFERENCES_VERSION = 1;

/**
 * Key bindings the author changed, laid over the product's defaults.
 *
 * Keyed by **binding**, not by command, and that is what lets one command carry
 * several keys — redo answers to both `Mod+Shift+Z` and `Mod+Y`, and a table the
 * other way round would have to make a list of it. A `null` value silences a
 * default without putting anything in its place, which is the only way to free
 * a key that would otherwise still be taken.
 *
 * The command is a `string` here for the same reason `SerializedLayout` is
 * `unknown`: which gestures exist is the editor's business, and `core` carries
 * this to disk without needing to know. The editor drops a binding naming a
 * command it does not have — a file written by a newer build, or by hand.
 */
export interface ShortcutPreferences {
  version: number;
  bindings: Record<string, string | null>;
}

export function emptyShortcutPreferences(): ShortcutPreferences {
  return { version: SHORTCUT_PREFERENCES_VERSION, bindings: {} };
}
