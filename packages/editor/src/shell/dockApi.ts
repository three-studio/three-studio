import type { DockviewApi, SerializedDockview } from 'dockview-react';
import { isUsableLayout } from './layoutStorage';
import { panelDef } from './panelDefs';

let api: DockviewApi | null = null;

export function setDockApi(next: DockviewApi | null): void {
  api = next;
  // Dockview owns the layout imperatively and publishes nothing to React, so
  // in development it is reachable for inspection and for automated checks.
  if (import.meta.env.DEV) {
    (globalThis as unknown as Record<string, unknown>)['__studioDockApi'] = next;
  }
}

/** The live dockview API, or `null` before the dock has mounted. */
export function dockApi(): DockviewApi | null {
  return api;
}

export function isPanelOpen(id: string): boolean {
  return api?.getPanel(id) !== undefined;
}

/** Ids of the panels currently in the layout. */
export function openPanelIds(): string[] {
  return api?.panels.map((panel) => panel.id) ?? [];
}

/**
 * Brings a panel to the front, creating it first if it was closed.
 *
 * Play does this for the Game panel. Without the "create it first" half,
 * closing that tab and pressing Play started the game with nothing on screen
 * to show it — running, invisible, and no way to tell.
 */
export function showPanel(id: string): void {
  if (!api) return;

  let panel = api.getPanel(id);
  if (!panel) {
    const def = panelDef(id);
    if (!def) return;
    api.addPanel(def.reopen(api));
    panel = api.getPanel(id);
  }
  panel?.api.setActive();
}

export function closePanel(id: string): void {
  api?.getPanel(id)?.api.close();
}

export function togglePanel(id: string): void {
  if (isPanelOpen(id)) closePanel(id);
  else showPanel(id);
}

/** The current arrangement, for saving as a template. */
export function captureLayout(): SerializedDockview | null {
  return api?.toJSON() ?? null;
}

/**
 * Replaces the arrangement with a saved one.
 *
 * Returns false if the layout could not be applied — it may name panels this
 * build no longer has. The caller restores the default rather than leaving the
 * user with an empty window.
 */
export function applyLayout(layout: SerializedDockview): boolean {
  if (!api) return false;
  // An empty layout deserialises without complaint and leaves nothing on
  // screen, so it is rejected here rather than by the try/catch.
  if (!isUsableLayout(layout)) return false;
  try {
    api.fromJSON(layout);
    return true;
  } catch {
    return false;
  }
}
