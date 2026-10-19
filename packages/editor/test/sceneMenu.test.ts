import { createEmptyScene, createMeshEntity, type SceneEntry } from '@three-studio/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addEntity } from '../src/commands/sceneCommands';
import { commandEntry } from '../src/shell/commandEntry';
import { buildSceneMenu, type SceneMenuInput } from '../src/shell/sceneMenu';
import { shortcutHint } from '../src/shell/shortcutBindings';
import { useDocumentStore } from '../src/state/documentStore';
import { useEditorStore } from '../src/state/editorStore';
import { useProjectStore } from '../src/state/projectStore';
import type { MenuEntry, MenuItem } from '../src/ui/Menu';

/*
 * The Scene menu holds every scene gesture, and decides none of them: each row
 * is its command's label, key, verdict and body. What the builder decides is
 * which rows exist, in what order, which one is checked, and where the
 * separators go — and that is what is pinned here, across the states a window
 * can build it in.
 */

// In path order, as `discoverScenes` hands them over: `L` sorts before `M`.
const LEVEL_2: SceneEntry = {
  id: 'level-2',
  name: 'Level 2',
  path: 'scenes/Level 2.scene.json',
  shadowedBy: null,
};
const MAIN: SceneEntry = { id: 'main', name: 'Main', path: 'scenes/Main.scene.json', shadowedBy: null };

/** The project as an open window leaves it, and the builder's input for that window. */
function open(scenes: readonly SceneEntry[], sceneId: string | null): SceneMenuInput {
  useProjectStore.setState({
    summary: { name: 'Races', path: '/projects/Races', lastOpenedAt: 1 },
    scenes: [...scenes],
    sceneId,
    saving: false,
  });
  return { scenes, sceneId };
}

/** Edits the document, so that it has something to save. */
function edit(): void {
  addEntity(createMeshEntity('box'));
}

/** Each state the bar can build the menu in, set up from nothing. */
const STATES: Record<string, () => SceneMenuInput> = {
  'one scene': () => open([MAIN], 'main'),
  'two scenes, on Main': () => open([LEVEL_2, MAIN], 'main'),
  'two scenes, on Level 2': () => open([LEVEL_2, MAIN], 'level-2'),
  'a dirty document': () => {
    const input = open([LEVEL_2, MAIN], 'main');
    edit();
    return input;
  },
  'a save in flight': () => {
    const input = open([LEVEL_2, MAIN], 'main');
    edit();
    useProjectStore.setState({ saving: true });
    return input;
  },
  'a sceneId that names no entry': () => open([LEVEL_2, MAIN], 'gone'),
};

/** What the menu reads, top to bottom, with `─` for a separator. */
const labels = (menu: readonly MenuEntry[]): string[] => menu.map((entry) => entry?.label ?? '─');

function row(menu: readonly MenuEntry[], label: string): MenuItem {
  const found = menu.find((entry) => entry?.label === label);
  if (!found) throw new Error(`no row "${label}" in ${labels(menu).join(' · ')}`);
  return found;
}

const submenu = (menu: readonly MenuEntry[], label: string): readonly MenuEntry[] =>
  row(menu, label).submenu ?? [];

/** What a person sees of a row and whether it can be picked. */
const shown = ({ label, shortcut, disabled }: MenuItem) => ({ label, shortcut, disabled });

beforeEach(() => {
  useDocumentStore.getState().replaceScene(createEmptyScene());
  useEditorStore.getState().clearSelection();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the order', () => {
  it('reads opening, then the document against its file, then the file', () => {
    expect(labels(buildSceneMenu(open([LEVEL_2, MAIN], 'main')))).toEqual([
      'New Scene…',
      'Open Scene',
      'Open in New Window',
      '─',
      'Save Scene',
      'Save Scene As…',
      '─',
      'Duplicate Scene…',
      'Rename Scene…',
      'Delete Scene',
    ]);
  });

  it.each(Object.keys(STATES))('puts a separator only between two rows: %s', (state) => {
    const menu = buildSceneMenu(STATES[state]!());
    expect(menu[0]).not.toBeNull();
    expect(menu.at(-1)).not.toBeNull();
    menu.forEach((entry, index) => {
      if (entry === null) expect(menu[index + 1], `after entry ${index}`).not.toBeNull();
    });
  });
});

describe('no guard of its own', () => {
  const BOUND = ['newScene', 'save', 'saveSceneAs', 'duplicateScene', 'renameScene', 'deleteScene'] as const;

  it.each(Object.keys(STATES))("carries each command's own label, key and verdict: %s", (state) => {
    const menu = buildSceneMenu(STATES[state]!());
    // Every row that is not a submenu's heading runs a command.
    const rows = menu.filter((entry): entry is MenuItem => entry !== null && entry.submenu === undefined);
    expect(rows.map(shown)).toEqual(BOUND.map((id) => shown(commandEntry(id))));
  });

  it('greys Delete Scene with one scene, and offers it with two', () => {
    expect(row(buildSceneMenu(open([MAIN], 'main')), 'Delete Scene').disabled).toBe(true);
    expect(row(buildSceneMenu(open([LEVEL_2, MAIN], 'main')), 'Delete Scene').disabled).toBe(false);
  });

  it('offers Save Scene once the document is edited, and not while it saves', () => {
    const input = open([LEVEL_2, MAIN], 'main');
    expect(shortcutHint('save')).toBeDefined();
    expect(row(buildSceneMenu(input), 'Save Scene')).toMatchObject({
      disabled: true,
      shortcut: shortcutHint('save'),
    });

    edit();
    expect(row(buildSceneMenu(input), 'Save Scene').disabled).toBe(false);

    useProjectStore.setState({ saving: true });
    expect(row(buildSceneMenu(input), 'Save Scene').disabled).toBe(true);
  });
});

describe('Open Scene ▸', () => {
  it("lists every scene in the list's order, the window's checked and still offered", () => {
    const rows = submenu(buildSceneMenu(open([LEVEL_2, MAIN], 'main')), 'Open Scene');
    expect(rows.map((entry) => entry && { ...shown(entry), checked: entry.checked })).toEqual([
      { label: 'Level 2', shortcut: undefined, disabled: false, checked: false },
      { label: 'Main', shortcut: undefined, disabled: false, checked: true },
    ]);
  });

  it('is there with one scene, so that the actions keep their places', () => {
    const rows = submenu(buildSceneMenu(open([MAIN], 'main')), 'Open Scene');
    expect(rows.map((entry) => entry?.label)).toEqual(['Main']);
  });

  it('switches to the scene a row names, and not to the one already open', () => {
    const switchScene = vi.fn(async (_sceneId: string) => {});
    vi.stubGlobal('window', { studio: { project: { switchScene } } });
    const [level2, main] = submenu(buildSceneMenu(open([LEVEL_2, MAIN], 'main')), 'Open Scene');

    main?.onSelect?.();
    expect(switchScene).not.toHaveBeenCalled();

    level2?.onSelect?.();
    expect(switchScene.mock.calls).toEqual([['level-2']]);
  });
});

describe('Open in New Window ▸', () => {
  it('offers the other scene', () => {
    const rows = submenu(buildSceneMenu(open([LEVEL_2, MAIN], 'main')), 'Open in New Window');
    expect(rows.map((entry) => entry && shown(entry))).toEqual([
      { label: 'Level 2', shortcut: undefined, disabled: false },
    ]);
  });

  it('is left out with one scene', () => {
    expect(labels(buildSceneMenu(open([MAIN], 'main')))).not.toContain('Open in New Window');
  });

  it('is left out when the other file only shadows this one', () => {
    // A copy of the window's own file, carrying its id: the walk lets the first
    // by path order answer to it, and the other can be opened nowhere. Shown
    // enabled, the heading would open an empty list.
    const copy: SceneEntry = {
      id: 'main',
      name: 'Main',
      path: 'scenes/old/Main.scene.json',
      shadowedBy: 'scenes/Main.scene.json',
    };
    expect(labels(buildSceneMenu(open([MAIN, copy], 'main')))).not.toContain('Open in New Window');
  });
});
