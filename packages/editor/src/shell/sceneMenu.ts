import { SCENES_DIR, findScene, type SceneEntry } from '@three-studio/core';
import { contextForScene } from '../commands/registry';
import { isStartScene } from '../commands/sceneFiles';
import type { MenuEntry, MenuItem } from '../ui/Menu';
import { commandEntry } from './commandEntry';

/*
 * Every scene gesture, in the bar's Scene menu, right after Add.
 *
 * They used to be in two places: New, Save and Save As under File, and the rest
 * in a menu that opened from the scene's name on the right of the bar, which
 * read as a title and not as a menu. One gesture now has one place, the way
 * Godot's Scene menu holds Save Scene too.
 *
 * Pure in the sense `addMenu.ts` is: no React, no subscription, nothing run
 * while the menu is built, so it can be called in node. The rows are the
 * commands' own (label, key, verdict and body), read from the stores when the
 * menu is built. This file decides which rows exist, which one is checked, what
 * a scene's row says beside its name, and the order — and it builds the one row
 * no command can: a shadowed file's.
 */

export interface SceneMenuInput {
  /** The project's scenes, in path order — `useProjectStore.scenes`. */
  scenes: readonly SceneEntry[];
  /** The window's scene — `useProjectStore.sceneId`. */
  sceneId: string | null;
  /** The scene a build starts on — `project.startScene`, or `null` with no project open. */
  startScene: string | null;
}

/**
 * The Scene menu, grouped by what each entry acts on: opening a scene, the
 * document against its file, the file, then what the scene is to the project.
 *
 * The separators are written by hand between the groups, as File and Edit
 * write theirs, because no group here can be empty: every entry is present in
 * every state, greyed when it cannot act. An entry that came and went would
 * need the rule (never first, never last, never doubled) enforced in code.
 */
export function buildSceneMenu(input: SceneMenuInput): MenuEntry[] {
  const { scenes, sceneId, startScene } = input;
  // The file that wins the window's id, which is the one the title names. A
  // shadowed file carrying the same id is not checked: the id never opens it.
  const current = sceneId === null ? undefined : findScene(scenes, sceneId);

  // Every window holds one scene, so another scene means another window. The
  // rows that can act there, filtered on the verdict each row already carries:
  // the command's, which refuses this window's own scene, and the shadowed
  // file's, which nothing can open. Not a `.filter` writing those conditions in
  // its own words, which is where they were, beside a `disabled` that said only
  // half of them.
  const elsewhere = sceneRows(input, 'openSceneInNewWindow').filter((row) => !row.disabled);

  return [
    commandEntry('newScene'),
    {
      label: 'Open Scene',
      // One row per file, the window's checked and still offered. A submenu
      // rather than rows at the top, so that the actions keep their places
      // however many scenes the project has; it is there with one scene too.
      submenu: sceneRows(input, 'openScene').map((row) => ({
        ...row,
        checked: row.key === current?.path,
      })),
    },
    // Left out rather than greyed when it has no row to offer: a greyed heading
    // that opens an empty list on hover is worse than no heading. That is a
    // project with one scene, and also one whose other file only shadows this
    // window's.
    ...(elsewhere.length > 0 ? [{ label: 'Open in New Window', submenu: elsewhere }] : []),
    null,
    commandEntry('save'),
    // Not `${modKey}${shiftKey}S`: that is Save All in every editor that has
    // both, and this project has no Save All to be confused with yet.
    commandEntry('saveSceneAs'),
    null,
    // Three entries that used to write their own guards in the menu, or none at
    // all: Duplicate and Rename had no `disabled` while both gestures open with
    // `if (sceneId === null) return`, and Delete carried the last-scene rule in
    // the menu rather than in the gesture. Each one is now the command's own
    // label and the command's own verdict.
    commandEntry('duplicateScene'),
    commandEntry('renameScene'),
    commandEntry('deleteScene'),
    null,
    // Aimed at the window's scene, the one the title names, and checked while
    // it is the start one — greyed then too, by the command: there is nothing
    // to set. Another scene becomes the start one by opening it, or from
    // Project Settings, which lists them all.
    {
      ...commandEntry('setStartScene'),
      checked: current !== undefined && isStartScene(current, startScene),
    },
  ];
}

/**
 * One row per file under `scenes/`, in the list's order: the gesture aimed at
 * each file in turn.
 *
 * Keyed by path, the one thing that is unique on disk — two files can share a
 * name, and two can share an id — while the gesture still aims at the id.
 */
function sceneRows(
  { scenes, startScene }: SceneMenuInput,
  command: 'openScene' | 'openSceneInNewWindow',
): MenuItem[] {
  const homonyms = repeatedNames(scenes);
  return scenes.map((entry) => {
    const detail = rowDetail(entry, homonyms.has(entry.name), startScene);
    if (entry.shadowedBy !== null) {
      /*
       * The one row built by hand. An id names the first file that claims it,
       * so no context can aim at this one: the command's row for its id
       * carried the winner's name and opened the winner, which showed one
       * scene twice and this file nowhere. Listed all the same, greyed, under
       * its own name: a file missing from the menu is far harder to find than
       * one shown with the reason beside it.
       */
      return { key: entry.path, label: entry.name, detail, disabled: true };
    }
    return { ...commandEntry(command, contextForScene(entry.id)), key: entry.path, detail };
  });
}

/** The names that two entries or more carry, compared exactly. */
function repeatedNames(scenes: readonly SceneEntry[]): Set<string> {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const { name } of scenes) (seen.has(name) ? repeated : seen).add(name);
  return repeated;
}

/**
 * What a scene's row says beside its name: `folder · state`.
 *
 * The folder first, because it completes the name, and only on a homonym —
 * anywhere else it is noise, and two rows that read alike are the only case it
 * settles. Not even then at the top of `scenes/`: the other homonym's folder
 * already tells the two apart. `Boss` and `boss` are not homonyms, since they
 * already read differently.
 *
 * Then the state: `start` or `duplicate id`, never both, since a shadowed file
 * is never the start scene. So a row says two things at most: `old · start`.
 */
function rowDetail(entry: SceneEntry, homonym: boolean, startScene: string | null): string | undefined {
  const said = [
    homonym ? entry.path.slice(`${SCENES_DIR}/`.length, entry.path.lastIndexOf('/')) : '',
    isStartScene(entry, startScene) ? 'start' : '',
    entry.shadowedBy === null ? '' : 'duplicate id',
  ].filter((part) => part !== '');
  return said.length > 0 ? said.join(' · ') : undefined;
}
