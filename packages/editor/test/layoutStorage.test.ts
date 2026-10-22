import { emptyLayoutPreferences, type LayoutPreferences } from '@three-studio/core';
import type { DockviewApi, SerializedDockview } from 'dockview-react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Layouts used to live in localStorage. They now live in a preferences file
 * owned by the main process, so a build that crosses that change has to carry
 * the old value over — exactly once, and without clobbering a newer one.
 */

interface Harness {
  storage: Map<string, string>;
  saved: LayoutPreferences[];
}

function install(stored: LayoutPreferences, seed: Record<string, string> = {}): Harness {
  const storage = new Map(Object.entries(seed));
  const saved: LayoutPreferences[] = [];

  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  });
  vi.stubGlobal('window', {
    studio: {
      preferences: {
        loadLayouts: async () => structuredClone(stored),
        saveLayouts: async (preferences: LayoutPreferences) => void saved.push(structuredClone(preferences)),
      },
    },
  });

  return { storage, saved };
}

/**
 * Smallest layout that would actually render: one group holding one panel. The
 * Viewport's component, so that this build can show it, under the tag as its id,
 * so that two of them tell apart.
 */
function validLayout(tag: string): unknown {
  return {
    grid: {
      root: { type: 'branch', data: [{ type: 'leaf', data: { views: [tag], activeView: tag, id: '1' } }] },
      width: 100,
      height: 100,
      orientation: 'HORIZONTAL',
    },
    panels: { [tag]: { id: tag, contentComponent: 'viewport', title: tag } },
  };
}

const legacyWorking = JSON.stringify({ version: 1, layout: validLayout('legacy') });
const legacyTemplates = JSON.stringify({
  version: 1,
  templates: [{ id: 'legacy-1', name: 'Old', layout: { LEGACY_TEMPLATE: true }, savedAt: 1 }],
});

async function freshModule() {
  vi.resetModules();
  return import('../src/shell/layoutStorage');
}

describe('layout preferences migration', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('moves a localStorage layout into the preferences file and clears the old keys', async () => {
    const harness = install(emptyLayoutPreferences(), {
      'studio.layout': legacyWorking,
      'studio.layoutTemplates': legacyTemplates,
    });
    const storage = await freshModule();

    await storage.loadLayoutPreferences();

    expect(storage.loadLayout()).toEqual(validLayout('legacy'));
    expect(storage.listTemplates().map((entry) => entry.name)).toEqual(['Old']);
    // Written back, so the next start reads it from the file instead.
    expect(harness.saved).toHaveLength(1);
    // And gone from localStorage, so it can never be migrated a second time.
    expect(harness.storage.has('studio.layout')).toBe(false);
    expect(harness.storage.has('studio.layoutTemplates')).toBe(false);
  });

  it('keeps the preferences file when both sources have a layout', async () => {
    const current: LayoutPreferences = {
      ...emptyLayoutPreferences(),
      working: validLayout('current'),
      templates: [{ id: 'kept', name: 'Kept', layout: validLayout('current'), savedAt: 2 }],
    };
    const harness = install(current, {
      'studio.layout': legacyWorking,
      'studio.layoutTemplates': legacyTemplates,
    });
    const storage = await freshModule();

    await storage.loadLayoutPreferences();

    expect(storage.loadLayout()).toEqual(validLayout('current'));
    expect(storage.listTemplates().map((entry) => entry.name)).toEqual(['Kept']);
    // Nothing changed, so nothing is written…
    expect(harness.saved).toHaveLength(0);
    // …but the stale keys still go, so this check does not run on every start.
    expect(harness.storage.has('studio.layout')).toBe(false);
  });

  it('survives an unparsable legacy value', async () => {
    install(emptyLayoutPreferences(), { 'studio.layout': '{not json' });
    const storage = await freshModule();

    await storage.loadLayoutPreferences();

    expect(storage.loadLayout()).toBeNull();
    expect(storage.layoutsLoaded()).toBe(true);
  });
});

describe('named templates', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('replaces a template that reuses a name, and sorts by name', async () => {
    const harness = install(emptyLayoutPreferences());
    const storage = await freshModule();
    await storage.loadLayoutPreferences();

    // The dock library owns this shape; the store only ever passes it through.
    const layout = (tag: string) => ({ tag }) as unknown as SerializedDockview;
    storage.saveTemplate('Wide', layout('first'));
    storage.saveTemplate('Animation', layout('other'));
    const replaced = storage.saveTemplate('Wide', layout('second'));

    expect(storage.listTemplates().map((entry) => entry.name)).toEqual(['Animation', 'Wide']);
    expect(storage.listTemplates().find((entry) => entry.name === 'Wide')?.layout).toEqual(
      layout('second'),
    );

    storage.deleteTemplate(replaced.id);
    expect(storage.listTemplates().map((entry) => entry.name)).toEqual(['Animation']);
    expect(harness.saved.at(-1)?.templates).toHaveLength(1);
  });
});

describe('layout validity', () => {
  const leaf = (views: string[]) => ({
    type: 'leaf',
    data: { views, activeView: views[0], id: '1' },
  });
  const layout = (root: unknown, panels: Record<string, unknown> = {}) =>
    ({
      grid: { root, width: 100, height: 100, orientation: 'HORIZONTAL' },
      panels,
    }) as unknown as SerializedDockview;

  it('accepts a layout that places at least one panel', async () => {
    const { isUsableLayout } = await freshModule();
    expect(isUsableLayout(layout({ type: 'branch', data: [leaf(['viewport'])] }))).toBe(true);
  });

  /*
   * The shape that bricked the editor: a panel that fails to construct is
   * removed from its group but stays in `panels`, so the file looks complete
   * while every group is empty. dockview restores it without complaint into a
   * window with no tabs and no content, and it survived every restart because
   * it lived in the preferences file rather than in the code.
   */
  it('rejects a layout whose groups are all empty', async () => {
    const { isUsableLayout } = await freshModule();
    const orphaned = layout({ type: 'branch', data: [leaf([]), leaf([])] }, {
      viewport: { id: 'viewport', contentComponent: 'viewport' },
      hierarchy: { id: 'hierarchy', contentComponent: 'hierarchy' },
    });
    expect(isUsableLayout(orphaned)).toBe(false);
  });

  it('rejects null and an empty grid', async () => {
    const { isUsableLayout } = await freshModule();
    expect(isUsableLayout(null)).toBe(false);
    expect(isUsableLayout(layout({ type: 'branch', data: [] }))).toBe(false);
  });

  it('does not hand back a stored layout that would render nothing', async () => {
    install({
      ...emptyLayoutPreferences(),
      working: { grid: { root: { type: 'branch', data: [] } }, panels: { a: { id: 'a', contentComponent: 'viewport' } } },
    });
    const storage = await freshModule();
    await storage.loadLayoutPreferences();

    expect(storage.loadLayout()).toBeNull();
  });

  /*
   * Every layout saved before the Game panel went names it, beside the
   * Viewport. Handed to dockview, `fromJSON` mounted the Viewport, threw on
   * `game`, and its revert left that Viewport mounted off the document for as
   * long as the dock lived — where it stopped every Play Full Screen. Such a
   * layout gives way to the default as it always did, only without dockview
   * ever seeing it.
   */
  const withGame = () =>
    layout({ type: 'branch', data: [leaf(['viewport', 'game'])] }, {
      viewport: { id: 'viewport', contentComponent: 'viewport', title: 'Scene' },
      game: { id: 'game', contentComponent: 'game', title: 'Game' },
    });

  it('rejects a layout naming a panel this build does not have', async () => {
    const { isUsableLayout } = await freshModule();
    const editorsOwn = layout({ type: 'branch', data: [leaf(['viewport', 'console'])] }, {
      viewport: { id: 'viewport', contentComponent: 'viewport' },
      console: { id: 'console', contentComponent: 'console' },
    });

    expect(isUsableLayout(withGame())).toBe(false);
    expect(isUsableLayout(editorsOwn)).toBe(true);
  });

  it('reads a panel’s component where dockview does: its view’s content first', async () => {
    const { isUsableLayout } = await freshModule();
    const panel = (view: unknown) =>
      layout({ type: 'branch', data: [leaf(['a'])] }, { a: { id: 'a', contentComponent: 'viewport', view } });

    expect(isUsableLayout(panel({ content: { id: 'game' } }))).toBe(false);
    expect(isUsableLayout(panel({ content: { id: 'inspector' } }))).toBe(true);
  });

  it('does not hand back a stored layout naming a panel this build does not have', async () => {
    install({ ...emptyLayoutPreferences(), working: withGame() });
    const storage = await freshModule();
    await storage.loadLayoutPreferences();

    expect(storage.loadLayout()).toBeNull();
  });

  it('does not hand dockview a template naming a panel this build does not have', async () => {
    await freshModule();
    const { applyLayout, setDockApi } = await import('../src/shell/dockApi');
    const fromJSON = vi.fn();
    setDockApi({ fromJSON } as unknown as DockviewApi);
    try {
      expect(applyLayout(withGame())).toBe(false);
      expect(fromJSON).not.toHaveBeenCalled();

      expect(applyLayout(validLayout('kept') as SerializedDockview)).toBe(true);
      expect(fromJSON).toHaveBeenCalledTimes(1);
    } finally {
      setDockApi(null);
    }
  });
});
