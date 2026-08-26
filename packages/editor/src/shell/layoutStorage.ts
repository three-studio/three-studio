import { emptyLayoutPreferences, type LayoutPreferences } from '@three-studio/core';
import type { SerializedDockview } from 'dockview-react';

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

/**
 * True when a layout would actually put something on screen.
 *
 * The check has to be on the grid, not on `panels`. A panel that fails to
 * construct is removed from its group but stays in the `panels` map, so the
 * serialised layout looks complete while every group is empty:
 *
 *     panels: { viewport, game, hierarchy, ... }        // all six
 *     grid:   leaves with `views: []`                   // none of them placed
 *
 * dockview restores that without complaint, into a window with the right
 * groups, no tabs, no content and no way back except the Window menu. One
 * broken render used to be enough to persist it and break every later start.
 */
export function isUsableLayout(layout: SerializedDockview | null): layout is SerializedDockview {
  if (layout === null) return false;

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
