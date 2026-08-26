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
