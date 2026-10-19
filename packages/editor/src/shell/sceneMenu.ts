import type { SceneEntry } from '@three-studio/core';
import { contextForScene } from '../commands/registry';
import type { MenuEntry } from '../ui/Menu';
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
 * menu is built. This file decides only which rows exist, which one is checked,
 * and the order.
 */

export interface SceneMenuInput {
  /** The project's scenes, in path order — `useProjectStore.scenes`. */
  scenes: readonly SceneEntry[];
  /** The window's scene — `useProjectStore.sceneId`. */
  sceneId: string | null;
}

/**
 * The Scene menu, grouped by what each entry acts on: opening a scene, the
 * document against its file, then the file.
 *
 * The separators are written by hand between the groups, as File and Edit
 * write theirs, because no group here can be empty: every entry is present in
 * every state, greyed when it cannot act. An entry that came and went would
 * need the rule (never first, never last, never doubled) enforced in code.
 */
export function buildSceneMenu({ scenes, sceneId }: SceneMenuInput): MenuEntry[] {
  // Every window holds one scene, so another scene means another window.
  // Filtered on the command's verdict rather than in a `.filter` writing its two
  // conditions in its own words, which is where they were, beside a `disabled`
  // that said only half of them.
  const elsewhere = scenes
    .map((scene) => commandEntry('openSceneInNewWindow', contextForScene(scene.id)))
    .filter((row) => !row.disabled);

  return [
    commandEntry('newScene'),
    {
      label: 'Open Scene',
      // One gesture pointed at each scene in turn. The `shadowedBy` rule (two
      // files claiming one id, where opening this one would open the other) is
      // the command's, and the submenu below reads the same one. A submenu
      // rather than rows at the top, so that the actions keep their places
      // however many scenes the project has; it is there with one scene too.
      submenu: scenes.map((scene) => ({
        ...commandEntry('openScene', contextForScene(scene.id)),
        checked: scene.id === sceneId,
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
  ];
}
