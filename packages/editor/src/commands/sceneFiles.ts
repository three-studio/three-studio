import { findScene, serializeScene, type SceneEntry } from '@three-studio/core';
import { askForText, askToConfirm } from '../state/dialogStore';
import { useDocumentStore } from '../state/documentStore';
import { useProjectStore } from '../state/projectStore';
import { notify } from '../state/toastStore';
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
 * Two different operations, easy to confuse:
 *
 * - **Retarget** — same document, new file (Save As, and a rename). No reload:
 *   what is on screen has not changed, and reloading would throw away the undo
 *   history.
 * - **Switch** — different document (open another scene, delete this one). A
 *   reload, through the main process, with the unsaved-changes prompt on the
 *   way. See ADR-0008.
 */

function report(cause: unknown): void {
  notify({
    kind: 'error',
    title: 'Could not do that to the scene',
    // IPC wraps a thrown error's message; the useful half is after the colon.
    description: (cause instanceof Error ? cause.message : String(cause)).replace(
      /^Error invoking remote method '[^']+':\s*\w*Error:\s*/,
      '',
    ),
  });
}

/** The scenes of the open project, in path order — see `discoverScenes`. */
export function sceneList(): readonly SceneEntry[] {
  return useProjectStore.getState().scenes;
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

/** Reloads this window on another scene, prompt included. */
export async function openScene(sceneId: string): Promise<void> {
  if (sceneId === useProjectStore.getState().sceneId) return;
  try {
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
 * Two calls rather than a dedicated handler: creating a scene is one operation
 * — a file appearing under `scenes/` — and a second way to do it would be a
 * second place for the name rules to be forgotten.
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
    const change = await window.studio.project.createScene(name);
    await window.studio.project.saveScene({
      projectPath: summary.path,
      scenePath: change.scene.path,
      contents: serializeScene(useDocumentStore.getState().scene),
    });
    useDocumentStore.getState().markClean();
    useProjectStore.getState().retarget(change, change.scene);
  } catch (cause) {
    report(cause);
  }
}

/**
 * Renames the scene: the file moves, and the document's own copy follows.
 *
 * No reference is rewritten — every one of them is an id (ADR-0005) — but the
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

export async function chooseStartScene(sceneId: string): Promise<void> {
  try {
    useProjectStore.getState().adoptContents(await window.studio.project.setStartScene(sceneId));
  } catch (cause) {
    report(cause);
  }
}
