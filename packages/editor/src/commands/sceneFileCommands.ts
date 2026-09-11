import { findScene, type SceneEntry } from '@three-studio/core';
import { useProjectStore } from '../state/projectStore';
import { defineCommand, type EditorContext } from './command';
import {
  chooseStartScene,
  deleteCurrentScene,
  duplicateCurrentScene,
  newScene,
  openScene,
  openSceneInNewWindow,
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

/**
 * The scene this context names, when it names one that exists.
 *
 * `undefined` rather than a throw for an id naming nothing: the Scene menu is
 * built from a list the main process last sent, and a file can go from under it
 * — deleted in the Finder, or by another window.
 */
function target(ctx: EditorContext): SceneEntry | undefined {
  return ctx.sceneId === undefined ? undefined : findScene(project().scenes, ctx.sceneId);
}

/**
 * Whether a named scene can be opened at all.
 *
 * `shadowedBy` is the case worth stating: two files under `scenes/` can carry
 * one `SceneDoc.id` — duplicating one in the Finder is enough — and only the
 * first by path order answers to it. Opening the second would open the first,
 * so it is offered and refused rather than dropped from the list, where it would
 * be far harder to find.
 */
function openable(ctx: EditorContext): boolean {
  return target(ctx)?.shadowedBy === null;
}

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

  /**
   * Reloads this window on another scene.
   *
   * The current scene is *not* refused: it is the checked row of what reads as a
   * radio list, and greying the row that says where you are would be strange.
   * `openScene` returns early for it — see there.
   */
  openScene: defineCommand({
    label: (ctx) => target(ctx)?.name ?? 'Open Scene',
    can: openable,
    run: (ctx) => (ctx.sceneId === undefined ? undefined : openScene(ctx.sceneId)),
  }),

  /** The same scene in a second window; focuses the one that already has it. */
  openSceneInNewWindow: defineCommand({
    label: (ctx) => target(ctx)?.name ?? 'Open in New Window',
    // Every window holds one scene, so the scene this window is on has no second
    // window to be opened in. The menu used to say this in a `.filter`, in its
    // own words, beside a `disabled` that said the `shadowedBy` half.
    can: (ctx) => openable(ctx) && ctx.sceneId !== project().sceneId,
    run: (ctx) => (ctx.sceneId === undefined ? undefined : openSceneInNewWindow(ctx.sceneId)),
  }),

  /** Which scene the project — and a build — starts on. */
  setStartScene: defineCommand({
    label: (ctx) => {
      const scene = target(ctx);
      return scene ? `Start On "${scene.name}"` : 'Set Start Scene';
    },
    can: (ctx) => target(ctx) !== undefined,
    run: (ctx) => (ctx.sceneId === undefined ? undefined : chooseStartScene(ctx.sceneId)),
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
