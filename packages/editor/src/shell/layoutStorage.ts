import { emptyLayoutPreferences, type LayoutPreferences } from '@three-studio/core';
import type { SerializedDockview } from 'dockview-react';
import { PANEL_DEFS } from './panelDefs';

export interface LayoutTemplate {
  id: string;
  name: string;
  layout: SerializedDockview;
  savedAt: number;
}

/**
 * Layouts are read once at startup and then served from memory.
 *
 * dockview builds its layout synchronously in `onReady`, so an async read at
 * that moment would show the default first and swap it a frame later. Loading
 * up front avoids that flash entirely.
 */
let cache: LayoutPreferences = emptyLayoutPreferences();
let loaded = false;

const LEGACY_WORKING_KEY = 'studio.layout';
const LEGACY_TEMPLATES_KEY = 'studio.layoutTemplates';

export function layoutsLoaded(): boolean {
  return loaded;
}

export async function loadLayoutPreferences(): Promise<void> {
  cache = await window.studio.preferences.loadLayouts();

  const migrated = migrateFromLocalStorage(cache);
  if (migrated) await persist();

  loaded = true;
}

/**
 * Moves anything an earlier build left in localStorage into the preferences
 * file, once. Layouts are a small thing to lose, but losing them silently
 * because the storage moved is the kind of paper cut that has no upside.
 */
function migrateFromLocalStorage(preferences: LayoutPreferences): boolean {
  let changed = false;

  try {
    const rawWorking = localStorage.getItem(LEGACY_WORKING_KEY);
    if (rawWorking !== null) {
      if (preferences.working === null) {
        preferences.working = (JSON.parse(rawWorking) as { layout?: unknown }).layout ?? null;
        changed = true;
      }
      localStorage.removeItem(LEGACY_WORKING_KEY);
    }

    const rawTemplates = localStorage.getItem(LEGACY_TEMPLATES_KEY);
    if (rawTemplates !== null) {
      const parsed = JSON.parse(rawTemplates) as { templates?: LayoutTemplate[] };
      if (preferences.templates.length === 0 && Array.isArray(parsed.templates)) {
        preferences.templates = parsed.templates;
        changed = true;
      }
      localStorage.removeItem(LEGACY_TEMPLATES_KEY);
    }
  } catch {
    // Nothing worth recovering; the default layout is a fine starting point.
  }

  return changed;
}

async function persist(): Promise<void> {
  await window.studio.preferences.saveLayouts(cache);
}

// --- working layout ---------------------------------------------------------

/** The panels this build can show, by the component key a serialised panel names. */
const KNOWN_COMPONENTS: ReadonlySet<string> = new Set(PANEL_DEFS.map((def) => def.component));

/**
 * The component a serialised panel names, read where dockview's deserializer
 * reads it: its view's content when it has a view, else `contentComponent`.
 */
function componentOf(panel: unknown): unknown {
  const { view, contentComponent } = (panel ?? {}) as {
    view?: { content?: { id?: unknown } };
    contentComponent?: unknown;
  };
  return view ? view.content?.id : contentComponent;
}

/**
 * True when a layout would actually put something on screen, and only panels
 * this build has.
 *
 * The first half has to be checked on the grid, not on `panels`. A panel that
 * fails to construct is removed from its group but stays in the `panels` map,
 * so the serialised layout looks complete while every group is empty:
 *
 *     panels: { viewport, hierarchy, inspector, ... }   // all five
 *     grid:   leaves with `views: []`                   // none of them placed
 *
 * dockview restores that without complaint, into a window with the right
 * groups, no tabs, no content and no way back except the Window menu. One
 * broken render used to be enough to persist it and break every later start.
 *
 * The second half is checked here rather than left to dockview to refuse, and
 * the refusal is what went wrong. A layout naming a panel this build lacks —
 * every one saved before the Game panel went names `game`, beside the Viewport
 * — makes `fromJSON` throw, but only after it has created and mounted the
 * panels before it in the same group, and its revert removes the panels it
 * had opened, which those were not yet. The Viewport it mounted stayed mounted,
 * off the document, for as long as the dock lived, and nothing remounts the
 * dock at startup: that orphan stopped every Play Full Screen the moment the
 * real stage took the screen, its own having been refused it.
 */
export function isUsableLayout(layout: SerializedDockview | null): layout is SerializedDockview {
  if (layout === null) return false;

  // Every panel the layout carries, placed or not: dockview writes only the
  // panels it holds, so a layout it wrote carries none it does not place.
  for (const panel of Object.values(layout.panels ?? {})) {
    const component = componentOf(panel);
    if (typeof component !== 'string' || !KNOWN_COMPONENTS.has(component)) return false;
  }

  let views = 0;
  const walk = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return;
    const branch = node as { type?: string; data?: unknown };
    if (branch.type === 'leaf') {
      views += ((branch.data as { views?: unknown[] } | undefined)?.views ?? []).length;
      return;
    }
    if (Array.isArray(branch.data)) branch.data.forEach(walk);
  };
  walk(layout.grid?.root);

  return views > 0;
}

export function saveLayout(layout: SerializedDockview): void {
  if (!isUsableLayout(layout)) return;
  cache.working = layout;
  void persist();
}

export function loadLayout(): SerializedDockview | null {
  const stored = (cache.working as SerializedDockview | null) ?? null;
  return isUsableLayout(stored) ? stored : null;
}

export function clearLayout(): void {
  cache.working = null;
  void persist();
}

// --- named templates --------------------------------------------------------

export function listTemplates(): LayoutTemplate[] {
  return (cache.templates as LayoutTemplate[]).slice().sort((a, b) => a.name.localeCompare(b.name));
}

/** Saves under `name`, replacing any template that already uses it. */
export function saveTemplate(name: string, layout: SerializedDockview): LayoutTemplate {
  const trimmed = name.trim();
  const existing = listTemplates();
  const template: LayoutTemplate = {
    id: existing.find((entry) => entry.name === trimmed)?.id ?? crypto.randomUUID(),
    name: trimmed,
    layout,
    savedAt: Date.now(),
  };

  cache.templates = [...existing.filter((entry) => entry.name !== trimmed), template];
  void persist();
  return template;
}

export function deleteTemplate(id: string): void {
  cache.templates = listTemplates().filter((entry) => entry.id !== id);
  void persist();
}
