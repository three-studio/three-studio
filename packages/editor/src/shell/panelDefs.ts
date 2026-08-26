import type { AddPanelOptions, DockviewApi } from 'dockview-react';

export interface PanelDef {
  id: string;
  /** Key into the component map passed to `DockviewReact`. */
  component: string;
  title: string;
  /**
   * Where this panel goes when it is created on its own — reopened from the
   * Window menu, or brought back because something needs it.
   *
   * Separate from the default layout because that builds panels in a known
   * order, whereas a lone panel has to find its own place among whatever
   * happens to be open.
   */
  reopen: (api: DockviewApi) => AddPanelOptions;
}

/** Puts a panel beside a sibling if that sibling is open, otherwise on an edge. */
function beside(
  id: string,
  component: string,
  title: string,
  siblingId: string,
  direction: 'within' | 'left' | 'right' | 'above' | 'below',
  fallback: 'left' | 'right' | 'above' | 'below',
): PanelDef {
  return {
    id,
    component,
    title,
    reopen: (api) =>
      api.getPanel(siblingId)
        ? { id, component, title, position: { referencePanel: siblingId, direction } }
        : { id, component, title, position: { direction: fallback } },
  };
}

/**
 * Every panel the editor can show.
 *
 * One table, used both to build the default layout and to bring a panel back,
 * so a panel can never exist in one place and not the other.
 */
export const PANEL_DEFS: readonly PanelDef[] = [
  {
    id: 'viewport',
    component: 'viewport',
    title: 'Scene',
    reopen: () => ({ id: 'viewport', component: 'viewport', title: 'Scene' }),
  },
  beside('game', 'game', 'Game', 'viewport', 'within', 'right'),
  beside('hierarchy', 'hierarchy', 'Hierarchy', 'viewport', 'left', 'left'),
  beside('inspector', 'inspector', 'Inspector', 'viewport', 'right', 'right'),
  beside('project', 'project', 'Project', 'viewport', 'below', 'below'),
  beside('console', 'console', 'Console', 'project', 'within', 'below'),
];

export function panelDef(id: string): PanelDef | undefined {
  return PANEL_DEFS.find((def) => def.id === id);
}
