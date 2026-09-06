import { useProjectStore } from '../state/projectStore';
import { defineCommand } from './command';
import {
  deleteCurrentScene,
  duplicateCurrentScene,
  newScene,
  renameCurrentSceneWithPrompt,
  saveSceneAs,
} from './sceneFiles';

/*
 * The gestures on the scene *file*: create one, copy it, rename it, delete it.
 *
 * Declared here rather than left as the free functions `MenuBar` was calling,
 * for the reason the Edit family exists: the menu was writing its own guards, in
 * its own words, and getting three of them wrong.
 *
 * - **Duplicate Scene… and Rename Scene… had no `disabled` at all**, while both
 *   gestures open with `if (sceneId === null) return`. With no project open the
 *   menu offered an entry, took the click, opened a dialog, and did nothing with
 *   the answer.
 * - **Save Scene As… the same**, with `if (!summary) return`.
 * - **Delete Scene** carried `disabled: scenes.length <= 1` in the menu rather
 *   than in the gesture, so the rule lived where only one caller could see it.
 *
 * Every `can()` below is one of those conditions, moved to the one place that
 * every caller reads. Nothing here is undoable and nothing here touches the
 * document — see the note at the top of `sceneFiles.ts`.
 */

const project = () => useProjectStore.getState();

/**
 * A window with a scene open. It is `null` before a project has loaded, which is
 * the state every guard below was written against.
 */
const hasScene = (): boolean => project().sceneId !== null;

export const SCENE_FILE_COMMANDS = {
  newScene: defineCommand({
    label: () => 'New Scene…',
    // The file lands under `scenes/` in the open project, so there has to be
    // one. `sceneId` is not the question here: a project whose scene failed to
    // load can still take a new one.
    can: () => project().summary !== null,
    run: () => newScene(),
  }),

  saveSceneAs: defineCommand({
    label: () => 'Save Scene As…',
    can: () => project().summary !== null,
    run: () => saveSceneAs(),
  }),

  duplicateScene: defineCommand({
    label: () => 'Duplicate Scene…',
    can: hasScene,
    run: () => duplicateCurrentScene(),
  }),

  renameScene: defineCommand({
    label: () => 'Rename Scene…',
    can: hasScene,
    run: () => renameCurrentSceneWithPrompt(),
  }),

  deleteScene: defineCommand({
    label: () => 'Delete Scene',
    /**
     * The main process refuses the last scene anyway — a project the editor
     * cannot reopen is the one refusal it keeps — so this is the same rule said
     * early enough to grey the entry instead of raising a toast after the click.
     */
    can: () => hasScene() && project().scenes.length > 1,
    run: () => deleteCurrentScene(),
  }),
};
