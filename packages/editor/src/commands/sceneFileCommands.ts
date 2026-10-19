import { findScene, type SceneEntry } from '@three-studio/core';
import { useProjectStore } from '../state/projectStore';
import { defineCommand, type EditorContext } from './command';
import {
  chooseStartScene,
  currentScene,
  deleteCurrentScene,
  duplicateCurrentScene,
  isStartScene,
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
 * Whether a named scene can be opened at all: whether its id names a file.
 *
 * Two files under `scenes/` can carry one `SceneDoc.id` — duplicating one in
 * the Finder is enough — and only the first by path order answers to it. That
 * is the file an id names: `findScene` never returns the other one from a list
 * `discoverScenes` made, so no context can aim at it, and there is nothing
 * shadowed for this guard to refuse. It used to test `shadowedBy` all the same,
 * and promise that such a file was offered and refused; that held only for a
 * test's list the main process cannot produce, while the menu, on a real one,
 * showed the shadowed file's row under the winner's name and opened the winner.
 * The Scene menu builds that file's row itself, greyed, with `duplicate id`.
 */
function openable(ctx: EditorContext): boolean {
  return target(ctx) !== undefined;
}

/**
 * The scene this context names, or this window's when it names none.
 *
 * A context naming a scene that is gone does not fall back on the window's: the
 * gesture was aimed at that scene — a row in Project Settings — and acting on
 * the one on screen would act on a scene nobody picked.
 */
function targetOrCurrent(ctx: EditorContext): SceneEntry | undefined {
  return ctx.sceneId === undefined ? (currentScene() ?? undefined) : target(ctx);
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

  /**
   * Which scene the project — and a build — starts on: the one the context
   * names, or this window's. The menu and the palette name none, so they set
   * the scene on screen, the one the title names; a Project Settings radio
   * names its own row's.
   *
   * It touches no document, so prefab mode and the game are left as they are.
   */
  setStartScene: defineCommand({
    label: () => 'Set as Start Scene',
    /*
     * Refused for the scene that already is the start scene. In the menu the
     * entry, greyed beside its check, says "already"; the palette leaves out a
     * gesture that would do nothing; and the main process writes whatever
     * project it is handed, so a click would put `project.json` in someone's
     * diff for nothing. A radio never meets the refusal: the start scene's is
     * the checked one, and a checked radio fires no change.
     */
    can: (ctx) => {
      const scene = targetOrCurrent(ctx);
      return scene !== undefined && !isStartScene(scene, project().project?.startScene ?? null);
    },
    run: (ctx) => {
      const scene = targetOrCurrent(ctx);
      return scene === undefined ? undefined : chooseStartScene(scene.id);
    },
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
