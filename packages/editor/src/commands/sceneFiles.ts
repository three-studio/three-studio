import { deserializeScene, findScene, serializeScene, type SceneEntry } from '@three-studio/core';
import { reportBrokenReferences } from '../state/brokenReport';
import { askForText, askToConfirm } from '../state/dialogStore';
import { pruneSelection, useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import { inPrefabMode, usePrefabModeStore } from '../state/prefabModeStore';
import { useProjectStore } from '../state/projectStore';
import { notify } from '../state/toastStore';
import { ipcErrorMessage } from './ipcError';
import { setSceneName } from './sceneCommands';

/*
 * Which scene this window is on, and which scenes the project has.
 *
 * Distinct from `sceneCommands.ts`, which edits the document: nothing here is
 * undoable, because none of it happens in the document. Creating, renaming and
 * deleting a scene are file operations under `scenes/`, and that directory is
 * the project's list of scenes — which is why they go through the main process,
 * and why this window is handed the list back rather than deducing it.
 *
 * Three different operations, easy to confuse:
 *
 * - **Retarget** — same document, new file (Save As, and a rename). No reload:
 *   what is on screen has not changed, and reloading would throw away the undo
 *   history. After a Save As the document also takes the new scene's id and
 *   name, which the file already holds.
 * - **Switch** — different document (open another scene, delete this one). A
 *   reload, through the main process, with the unsaved-changes prompt on the
 *   way.
 * - **Revert** — same file, read back into the document, in place. A load,
 *   which drops the history and leaves the document clean, without the reload.
 */

function report(cause: unknown, title = 'Could not do that to the scene'): void {
  notify({ kind: 'error', title, description: ipcErrorMessage(cause) });
}

/** The scene this window is on, or `null` before a project has opened. */
export function currentScene(): SceneEntry | null {
  const { scenes, sceneId } = useProjectStore.getState();
  if (sceneId === null) return null;
  return findScene(scenes, sceneId) ?? null;
}

export function currentSceneName(): string {
  return currentScene()?.name ?? 'Scene';
}

/**
 * Whether this file is the one a build starts on: the first that claims the
 * start id. A shadowed file carrying the same id is not — every lookup lands
 * on the first (`findScene`) — so comparing ids alone would mark it too.
 *
 * One rule for every place that marks or sets the start scene: Project
 * Settings, the Scene menu and Set as Start Scene.
 */
export function isStartScene(entry: SceneEntry, startScene: string | null): boolean {
  return entry.shadowedBy === null && entry.id === startScene;
}

/**
 * Ends what stands between this window and its scene: Prefab Mode, saving
 * every open prefab on the way, then the game when asked. Resolves once the
 * document is the scene.
 *
 * For a gesture that acts on the scene through the document — writes it, puts
 * a name in it, marks it clean. In Prefab Mode the document is the prefab, and
 * Save As wrote the prefab out as a scene.
 *
 * Prefab Mode goes first. Stop puts back the scene Play started from, into
 * whatever the document is: stopped first, it would put the scene into the
 * prefab, and leaving would then save every entity of the scene into the
 * prefab's file — what Stop did to a prefab opened during Play. Both are on at
 * once only while Play is still leaving Prefab Mode, since a prefab cannot be
 * opened while the game runs; the order holds there too.
 *
 * The store's `stop`, not the `stop` command: this file importing the registry
 * would close a cycle, since the registry imports the commands built on it.
 */
export async function backToTheScene(options: { stopPlay: boolean }): Promise<void> {
  if (inPrefabMode()) await usePrefabModeStore.getState().exit();
  if (options.stopPlay && useEditorStore.getState().playState !== 'stopped') {
    useEditorStore.getState().stop();
  }
}

/**
 * Reloads this window on another scene, prompt included.
 *
 * Neither Prefab Mode nor the game is ended here: the reload ends both, and
 * the main process's unsaved-changes prompt comes with it, after anything done
 * here — leaving first would leave the window out of its prefab, its game
 * stopped, behind a Cancel. What the reload would lose is the open prefabs'
 * edits, so those are saved where they stand; what is still unsaved then is the
 * scene's work, which is what the prompt is about.
 */
export async function openScene(sceneId: string): Promise<void> {
  // The checked row: nothing to open, so nothing to save either.
  if (sceneId === useProjectStore.getState().sceneId) return;
  try {
    await usePrefabModeStore.getState().saveAll();
    await window.studio.project.switchScene(sceneId);
  } catch (cause) {
    report(cause);
  }
}

/** The same scene, in a second window. Focuses the window that already has it. */
export async function openSceneInNewWindow(sceneId: string): Promise<void> {
  try {
    await window.studio.project.openSceneWindow(sceneId);
  } catch (cause) {
    report(cause);
  }
}

export async function newScene(): Promise<void> {
  const name = await askForText({
    title: 'New Scene',
    label: 'Name',
    defaultValue: 'Scene',
    confirmLabel: 'Create',
  });
  if (name === null) return;

  try {
    // Saved and left open, as for Open Scene: the reload below ends them.
    await usePrefabModeStore.getState().saveAll();
    const { scene } = await window.studio.project.createScene(name);
    // Switched to rather than merely created: an author who asks for a new
    // scene means to start working in it.
    await window.studio.project.switchScene(scene.id);
  } catch (cause) {
    report(cause);
  }
}

/**
 * Writes this document to a new scene file and points the window at it.
 *
 * One call, `createScene`'s, which New Scene makes too, so the name rules stay
 * in one place. The main process writes the document under the new scene's own
 * id and name, as it does for Duplicate's copy, and notes this window onto it
 * in that same call; the document then takes them as well. It used to be a
 * create and then a save of the document as it was, original id and name
 * included: the next walk of `scenes/` found two files claiming one scene and
 * hid one — the original, under the default name, which sorts after the copy —
 * and left this window on an id no file carried.
 */
export async function saveSceneAs(): Promise<void> {
  const { summary } = useProjectStore.getState();
  if (!summary) return;

  const name = await askForText({
    title: 'Save Scene As',
    label: 'Name',
    defaultValue: `${currentSceneName()} Copy`,
    confirmLabel: 'Save',
  });
  if (name === null) return;

  try {
    // What gets written is the document, so it has to be the scene. And the
    // game stops: Stop puts back the document Play started from, which would
    // then read as saved against a file it does not match — and would carry
    // the original's id and name back over the copy's.
    await backToTheScene({ stopPlay: true });
    const change = await window.studio.project.createScene(
      name,
      serializeScene(useDocumentStore.getState().scene),
    );
    // The copy's file holds this document under the copy's id and name; the
    // document has to say so too, or the next save writes the original's back.
    // The name the file settled on, as for a rename.
    useDocumentStore.getState().adoptIdentity({ id: change.scene.id, name: change.scene.name });
    useDocumentStore.getState().markClean();
    useProjectStore.getState().retarget(change, change.scene);
  } catch (cause) {
    report(cause);
  }
}

/**
 * Renames the scene: the file moves, and the document's own copy follows.
 *
 * No reference is rewritten — every one of them is an id — but the
 * path is not a reference, it is where this window saves, so the window
 * retargets onto the file that has just moved. Forgetting that is a scene
 * written back under its old name at the next save, and two files afterwards.
 *
 * The document keeps a copy of the name because a build falls back to it for
 * the window title, and because a scene should say what it is called even when
 * it is read on its own.
 */
export async function renameCurrentScene(name: string): Promise<void> {
  const sceneId = useProjectStore.getState().sceneId;
  if (sceneId === null) return;

  try {
    // The document's copy of the name goes on the scene, not on a prefab open
    // over it. And the game stops first: Stop puts back the document Play
    // started from, old name included, while the file keeps the new one.
    await backToTheScene({ stopPlay: true });
    const change = await window.studio.project.renameScene(sceneId, name);
    useProjectStore.getState().retarget(change, change.scene);
    // The name the file settled on, not the one that was typed: it may have
    // had characters a file name cannot hold.
    setSceneName(change.scene.name);
  } catch (cause) {
    report(cause);
  }
}

export async function renameCurrentSceneWithPrompt(): Promise<void> {
  const name = await askForText({
    title: 'Rename Scene',
    label: 'Name',
    defaultValue: currentSceneName(),
    confirmLabel: 'Rename',
  });
  if (name !== null) await renameCurrentScene(name);
}

export async function duplicateCurrentScene(): Promise<void> {
  const sceneId = useProjectStore.getState().sceneId;
  if (sceneId === null) return;

  const name = await askForText({
    title: 'Duplicate Scene',
    label: 'Name',
    defaultValue: `${currentSceneName()} Copy`,
    confirmLabel: 'Duplicate',
  });
  if (name === null) return;

  try {
    // Saved and left open, as for Open Scene: the reload below ends them.
    await usePrefabModeStore.getState().saveAll();
    const { scene } = await window.studio.project.duplicateScene(sceneId, name);
    await window.studio.project.switchScene(scene.id);
  } catch (cause) {
    report(cause);
  }
}

/**
 * Deletes this scene and moves the window to another one.
 *
 * Refused for the last scene by the main process, so the confirmation is about
 * losing a level rather than about breaking the project.
 */
export async function deleteCurrentScene(): Promise<void> {
  const sceneId = useProjectStore.getState().sceneId;
  if (sceneId === null) return;

  const confirmed = await askToConfirm({
    title: `Delete "${currentSceneName()}"?`,
    message: 'The scene file is removed from the project. This cannot be undone.',
    confirmLabel: 'Delete',
    destructive: true,
  });
  if (!confirmed) return;

  try {
    // The `markClean` below has to reach the scene. In Prefab Mode it marked
    // the prefab clean, and the scene's edits, set aside, made the main
    // process offer to discard them — the edits of a scene just deleted. The
    // game stops too: the reload would end it, but when another window already
    // shows the next scene the switch only brings that one forward, and this
    // one would go on running a deleted scene.
    await backToTheScene({ stopPlay: true });
    const { project, scenes } = await window.studio.project.deleteScene(sceneId);
    // Before the switch, or its guard would offer to save a document whose
    // file has just been removed.
    useDocumentStore.getState().markClean();

    const next = project.startScene || scenes[0]?.id;
    // Nothing left to show: deleting the last scene is refused, so this can
    // only be a project that was already broken on disk.
    if (next !== undefined && next !== '') await window.studio.project.switchScene(next);
  } catch (cause) {
    report(cause);
  }
}

/**
 * Drops the scene's unsaved work: the document becomes what its file holds.
 *
 * In place rather than through the main process's reload of this window,
 * which it would offer for its own scene: that prompt speaks of opening another
 * scene, the window goes blank for a second, and nothing a reload tears down
 * belongs to the work being dropped. A load gives the document what a reload
 * would — clean, with no history, the file's own id and name.
 *
 * The file is read before anything is left, so a file that is gone, that does
 * not read, or that now holds another scene leaves the document, the open
 * prefabs and the game as they were — and Save Scene can still write it.
 */
export async function revertCurrentScene(): Promise<void> {
  const { sceneId, scenePath } = useProjectStore.getState();
  if (sceneId === null || scenePath === null) return;

  const confirmed = await askToConfirm({
    title: `Revert "${currentSceneName()}"?`,
    message:
      'Its unsaved changes are discarded, and the scene is read again from its file. ' +
      'Changes already written to materials and prefabs stay. This cannot be undone.',
    confirmLabel: 'Revert',
    destructive: true,
  });
  if (!confirmed) return;

  try {
    const saved = deserializeScene(await window.studio.project.readScene(scenePath));
    // Since Save As writes a scene of its own, a file carries its window's id
    // unless something outside the editor put another scene there. Loading it
    // would leave this window — its URL, the main process's table — on an id
    // the document no longer carries, and a reload would not find the file.
    if (saved.id !== sceneId) {
      throw new Error(`${scenePath} now holds another scene, "${saved.name}". Nothing was changed.`);
    }
    // The document is the scene from here on, and the game is stopped: Stop
    // puts back the document Play started from, which would bring the dropped
    // work back over the file's.
    await backToTheScene({ stopPlay: true });
    useDocumentStore.getState().replaceScene(saved);
    // After the document, as an edit prunes. A load prunes nothing, and one
    // selected id naming nothing leaves the Inspector blank.
    const { selection, setSelection } = useEditorStore.getState();
    setSelection(pruneSelection(saved, selection));
    // Said again: the file can point at what the session had dealt with — an
    // entity removed since, whose asset is gone, comes back with it.
    reportBrokenReferences();
  } catch (cause) {
    report(cause, 'Could not revert the scene');
  }
}

/**
 * Shows the scene's own settings: the Inspector's pane with nothing selected.
 *
 * Out of Prefab Mode first, saving the open prefabs: with a prefab open that
 * pane belongs to the prefab's document, whose environment is scratch and
 * whose Name field is gone. The game keeps running — nothing here replaces the
 * document. The Inspector comes forward through `panelFocus`; this does not
 * reach into the dock.
 */
export async function showSceneSettings(): Promise<void> {
  try {
    await backToTheScene({ stopPlay: false });
  } catch (cause) {
    report(cause);
    return;
  }
  // Emptied once out of Prefab Mode, which puts back the selection the scene
  // had when the prefab was opened.
  const editor = useEditorStore.getState();
  editor.clearSelection();
  editor.requestSceneSettings();
}

export async function chooseStartScene(sceneId: string): Promise<void> {
  try {
    useProjectStore.getState().adoptContents(await window.studio.project.setStartScene(sceneId));
  } catch (cause) {
    report(cause);
  }
}

/**
 * Shows this scene's file in the system's file manager.
 *
 * `scenePath`, the file this window saves to — the one a person goes looking
 * for. Prefab Mode and the game are left alone: nothing here reads or replaces
 * the document.
 */
export async function revealCurrentScene(): Promise<void> {
  const { scenePath } = useProjectStore.getState();
  if (scenePath === null) return;
  try {
    await window.studio.assets.revealInFileManager(scenePath);
  } catch (cause) {
    report(cause, 'Could not show the scene file');
  }
}
