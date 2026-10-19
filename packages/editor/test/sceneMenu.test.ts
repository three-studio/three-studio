import {
  PROJECT_FORMAT_VERSION,
  createBuildProfiles,
  createEmptyScene,
  createMeshEntity,
  createPhysicsSettings,
  createRenderingSettings,
  sceneName,
  type ProjectFile,
  type SceneEntry,
} from '@three-studio/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addEntity } from '../src/commands/sceneCommands';
import { showInFileManagerLabel } from '../src/platform';
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

/*
 * Lists `discoverScenes` can produce, and only those: in path order by code
 * unit, each name its file's, the first file claiming an id winning it. The
 * test that let a shadowed file's row open another file held a list with none
 * of these properties.
 */
const scene = (path: string, id: string, shadowedBy: string | null = null): SceneEntry => ({
  id,
  name: sceneName(path),
  path,
  shadowedBy,
});

/**
 * A copy made in the Finder, which keeps the original's id. A space sorts
 * before the dot, so the copy comes first and wins the id: the original is the
 * shadowed file.
 */
const COPY = [
  scene('scenes/Boss copy.scene.json', 'b'),
  scene('scenes/Boss.scene.json', 'b', 'scenes/Boss copy.scene.json'),
  scene('scenes/Main.scene.json', 'a'),
];
/** Two scenes called Boss, each with an id of its own. */
const HOMONYMS = [
  scene('scenes/Boss.scene.json', 'b'),
  scene('scenes/Main.scene.json', 'a'),
  scene('scenes/old/Boss.scene.json', 'd'),
];
/** The homonyms, and a copy of Main in `old/` that keeps its id. */
const BOTH = [...HOMONYMS, scene('scenes/old/Main.scene.json', 'a', 'scenes/Main.scene.json')];

const startingOn = (startScene: string): ProjectFile => ({
  version: PROJECT_FORMAT_VERSION,
  name: 'Races',
  engineVersion: '0.1.0',
  startScene,
  settings: {
    loadingScene: null,
    rendering: createRenderingSettings(),
    physics: createPhysicsSettings(),
    build: createBuildProfiles('Races'),
  },
});

/**
 * The project as an open window leaves it, and the builder's input for that
 * window. With no start scene there is no project file either, so no file is
 * the start one and Set as Start Scene is offered on any scene.
 */
function open(
  scenes: readonly SceneEntry[],
  sceneId: string | null,
  startScene: string | null = null,
): SceneMenuInput {
  useProjectStore.setState({
    summary: { name: 'Races', path: '/projects/Races', lastOpenedAt: 1 },
    project: startScene === null ? null : startingOn(startScene),
    scenes: [...scenes],
    sceneId,
    saving: false,
  });
  return { scenes, sceneId, startScene };
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
  'homonyms, and a copy that keeps its id': () => open(BOTH, 'a'),
  'the window on the start scene': () => open(HOMONYMS, 'a', 'a'),
  'another scene the start one': () => open(HOMONYMS, 'a', 'b'),
  'a start scene that names no file': () => open(HOMONYMS, 'a', 'gone'),
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

/** The rows of a scene submenu, which has no separators. */
function rowsIn(menu: readonly MenuEntry[], label: string): MenuItem[] {
  return submenu(menu, label).map((entry) => {
    if (entry === null) throw new Error(`a separator in ${label}`);
    return entry;
  });
}

/** What a person sees of a row and whether it can be picked. */
const shown = ({ label, shortcut, disabled }: MenuItem) => ({ label, shortcut, disabled });

/** What a scene row says beside its name, and what tells it from its siblings. */
const said = ({ key, label, detail, disabled }: MenuItem) => ({ key, label, detail, disabled });

beforeEach(() => {
  useDocumentStore.getState().replaceScene(createEmptyScene());
  useEditorStore.getState().clearSelection();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the order', () => {
  it('reads opening, then the document against its file, then the file, then the project', () => {
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
      '─',
      'Set as Start Scene',
      'Scene Settings…',
      showInFileManagerLabel(),
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
  const BOUND = [
    'newScene',
    'save',
    'saveSceneAs',
    'duplicateScene',
    'renameScene',
    'deleteScene',
    'setStartScene',
    'sceneSettings',
    'revealScene',
  ] as const;

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

  it('switches to the scene a row names, and not to the one already open', async () => {
    const switchScene = vi.fn(async (_sceneId: string) => {});
    vi.stubGlobal('window', { studio: { project: { switchScene } } });
    const [level2, main] = submenu(buildSceneMenu(open([LEVEL_2, MAIN], 'main')), 'Open Scene');

    main?.onSelect?.();
    expect(switchScene).not.toHaveBeenCalled();

    // Not at once: an open prefab is saved before the switch is asked for.
    level2?.onSelect?.();
    await vi.waitFor(() => expect(switchScene.mock.calls).toEqual([['level-2']]));
  });

  it('gives a shadowed file a row of its own, greyed, under its own name', async () => {
    const switchScene = vi.fn(async (_sceneId: string) => {});
    vi.stubGlobal('window', { studio: { project: { switchScene } } });
    const rows = rowsIn(buildSceneMenu(open(COPY, 'a')), 'Open Scene');

    // The middle row used to read `Boss copy`, offered, and open the copy: it
    // was the command aimed at `b`, and `b` names the copy.
    expect(rows.map(said)).toEqual([
      { key: 'scenes/Boss copy.scene.json', label: 'Boss copy', detail: undefined, disabled: false },
      { key: 'scenes/Boss.scene.json', label: 'Boss', detail: 'duplicate id', disabled: true },
      { key: 'scenes/Main.scene.json', label: 'Main', detail: undefined, disabled: false },
    ]);
    expect(rows[1]!.onSelect).toBeUndefined();

    rows[0]!.onSelect?.();
    await vi.waitFor(() => expect(switchScene.mock.calls).toEqual([['b']]));
  });

  it('names the folder of homonyms, and of them only', async () => {
    const switchScene = vi.fn(async (_sceneId: string) => {});
    vi.stubGlobal('window', { studio: { project: { switchScene } } });
    const rows = rowsIn(buildSceneMenu(open(HOMONYMS, 'a')), 'Open Scene');

    // No folder for the Boss at the top of `scenes/`: the other one's is
    // enough to tell them apart.
    expect(rows.map((entry) => [entry.label, entry.detail])).toEqual([
      ['Boss', undefined],
      ['Main', undefined],
      ['Boss', 'old'],
    ]);

    rows[0]!.onSelect?.();
    rows[2]!.onSelect?.();
    await vi.waitFor(() => expect(switchScene.mock.calls).toEqual([['b'], ['d']]));
  });

  it('keys every row by its path, since names repeat', () => {
    const rows = rowsIn(buildSceneMenu(open(BOTH, 'a')), 'Open Scene');
    expect(rows.map((entry) => entry.label)).toEqual(['Boss', 'Main', 'Boss', 'Main']);
    expect(rows.map((entry) => entry.key)).toEqual(BOTH.map((entry) => entry.path));
  });

  it('says the folder, then the state, on one row', () => {
    const rows = rowsIn(buildSceneMenu(open(BOTH, 'a')), 'Open Scene');
    expect(said(rows[3]!)).toEqual({
      key: 'scenes/old/Main.scene.json',
      label: 'Main',
      detail: 'old · duplicate id',
      disabled: true,
    });
  });

  it("checks the file that wins the window's id, never a shadowed file carrying it", () => {
    expect(rowsIn(buildSceneMenu(open(COPY, 'b')), 'Open Scene').map((entry) => entry.checked)).toEqual([
      true,
      false,
      false,
    ]);
    expect(rowsIn(buildSceneMenu(open(BOTH, 'a')), 'Open Scene').map((entry) => entry.checked)).toEqual([
      false,
      true,
      false,
      false,
    ]);
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

  it('holds the rows of Open Scene ▸ that can act, with their folder and their key', () => {
    const openSceneWindow = vi.fn(async (_sceneId: string) => {});
    vi.stubGlobal('window', { studio: { project: { openSceneWindow } } });
    const rows = rowsIn(buildSceneMenu(open(HOMONYMS, 'a')), 'Open in New Window');

    expect(rows.map(said)).toEqual([
      { key: 'scenes/Boss.scene.json', label: 'Boss', detail: undefined, disabled: false },
      { key: 'scenes/old/Boss.scene.json', label: 'Boss', detail: 'old', disabled: false },
    ]);

    rows.forEach((entry) => entry.onSelect?.());
    expect(openSceneWindow.mock.calls).toEqual([['b'], ['d']]);
  });

  it("names a homonym's folder even when its namesake is not listed", () => {
    // The window is on the top-level Boss, so only the other one is listed. It
    // still says `old`: Open Scene ▸ shows both, and one file has to read the
    // same in both lists.
    const rows = rowsIn(buildSceneMenu(open(HOMONYMS, 'b')), 'Open in New Window');
    expect(rows.map((entry) => [entry.label, entry.detail])).toEqual([
      ['Main', undefined],
      ['Boss', 'old'],
    ]);
  });

  it("leaves out this window's scene and a shadowed file", () => {
    // Main is this window's, and its namesake in `old/` carries an id that
    // names Main: no window can be opened on that file.
    const rows = rowsIn(buildSceneMenu(open(BOTH, 'a')), 'Open in New Window');
    expect(rows.map(said)).toEqual([
      { key: 'scenes/Boss.scene.json', label: 'Boss', detail: undefined, disabled: false },
      { key: 'scenes/old/Boss.scene.json', label: 'Boss', detail: 'old', disabled: false },
    ]);
  });

  it('does not offer a shadowed file under the name of the file that wins its id', () => {
    // The shadowed `Boss` used to be listed here as a second `Boss copy`, which
    // opened the copy.
    const rows = rowsIn(buildSceneMenu(open(COPY, 'a')), 'Open in New Window');
    expect(rows.map((entry) => entry.key)).toEqual(['scenes/Boss copy.scene.json']);
  });
});

describe('the start scene', () => {
  /** What each row of a submenu says beside its name. */
  const details = (input: SceneMenuInput, label = 'Open Scene') =>
    rowsIn(buildSceneMenu(input), label).map((entry) => entry.detail);

  it('says so on its row', () => {
    expect(details(open(HOMONYMS, 'a', 'a'))).toEqual([undefined, 'start', 'old']);
  });

  it('is the file that wins the start id, never a shadowed copy carrying it', () => {
    expect(details(open(COPY, 'a', 'b'))).toEqual(['start', 'duplicate id', undefined]);
  });

  it('is said nowhere when the start id names no file', () => {
    expect(details(open(HOMONYMS, 'a', 'gone'))).toEqual([undefined, undefined, 'old']);
  });

  it('comes after the folder on one row', () => {
    expect(details(open(BOTH, 'a', 'd'))).toEqual([undefined, undefined, 'old · start', 'old · duplicate id']);
  });

  it('is said in Open in New Window ▸ too', () => {
    expect(details(open(HOMONYMS, 'a', 'd'), 'Open in New Window')).toEqual([undefined, 'old · start']);
  });
});

describe('Set as Start Scene', () => {
  // The verdict is the command's, which refuses the start scene itself; the
  // check is all the builder adds.
  it.each([
    ['is checked and greyed on the start scene', 'a', 'a', { checked: true, disabled: true }],
    ['is offered while another scene is the start one', 'a', 'b', { checked: false, disabled: false }],
    ['is offered when the start id names no file', 'a', 'gone', { checked: false, disabled: false }],
    ['is greyed when the window names no scene', 'gone', 'a', { checked: false, disabled: true }],
  ])('%s', (_, sceneId, startScene, expected) => {
    const entry = row(buildSceneMenu(open(HOMONYMS, sceneId, startScene)), 'Set as Start Scene');
    expect({ checked: entry.checked, disabled: entry.disabled }).toEqual(expected);
  });

  it("makes the window's scene the start scene", () => {
    const setStartScene = vi.fn(async (_sceneId: string) => ({ project: startingOn('a'), scenes: HOMONYMS }));
    vi.stubGlobal('window', { studio: { project: { setStartScene } } });

    row(buildSceneMenu(open(HOMONYMS, 'a', 'b')), 'Set as Start Scene').onSelect?.();
    expect(setStartScene.mock.calls).toEqual([['a']]);
  });
});
