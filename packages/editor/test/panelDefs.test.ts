import type { DockviewApi } from 'dockview-react';
import { describe, expect, it } from 'vitest';
import { PANEL_DEFS, panelDef } from '../src/shell/panelDefs';

/*
 * The panels the editor can show, which the Window menu lists in this order.
 * The game plays in the Viewport, so there is no Game panel among them, and a
 * Viewport closed during Play — or before it — has to come back somewhere it
 * can show the game: it is the game's only view.
 */

/** A dock that holds exactly these panels, as far as `reopen` can ask. */
const dockWith = (...open: string[]) =>
  ({ getPanel: (id: string) => (open.includes(id) ? { id } : undefined) }) as unknown as DockviewApi;

describe('the panels', () => {
  it('are the Viewport, the Hierarchy, the Inspector, the Project panel and the Console', () => {
    expect(PANEL_DEFS.map((def) => def.id)).toEqual(['viewport', 'hierarchy', 'inspector', 'project', 'console']);
    expect(panelDef('game')).toBeUndefined();
  });

  it('call the Viewport a Viewport', () => {
    expect(panelDef('viewport')?.title).toBe('Viewport');
  });
});

describe('where the Viewport comes back', () => {
  const reopen = (...open: string[]) => panelDef('viewport')!.reopen(dockWith(...open));

  it('goes above the Project panel when that is open, as the default arrangement has it', () => {
    expect(reopen('hierarchy', 'project', 'console').position).toEqual({
      referencePanel: 'project',
      direction: 'above',
    });
  });

  it('goes right of the Hierarchy when only that is open', () => {
    expect(reopen('hierarchy', 'inspector').position).toEqual({ referencePanel: 'hierarchy', direction: 'right' });
  });

  it('goes into the active group when neither is', () => {
    const options = reopen('inspector');
    expect(options).toEqual({ id: 'viewport', component: 'viewport', title: 'Viewport' });
  });
});
