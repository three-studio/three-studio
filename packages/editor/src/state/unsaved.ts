import { selectDirty, useDocumentStore } from './documentStore';
import { selectSetAsideUnsaved, usePrefabModeStore } from './prefabModeStore';

/*
 * What this window holds that is not on disk — two questions, which Prefab Mode
 * makes different.
 *
 * Opening a prefab sets the scene's history aside in a frame and loads the
 * prefab clean. Asking the document alone, as the dot, Cmd+S and the main
 * process all did, then answered "saved" while the scene's edits sat in that
 * frame: the dot went out, Save Scene greyed, and closing the window with an
 * untouched prefab open lost the scene's work without a prompt.
 *
 * "Unsaved" is `revision !== savedRevision`, for the document and for a frame's
 * stash alike.
 */

/**
 * The scene's own edits are not on disk — in the document, or set aside under
 * Prefab Mode. What a revert of the scene would drop: a prefab's edits are not
 * part of it.
 */
export function sceneUnsaved(): boolean {
  const scene = usePrefabModeStore.getState().stack[0];
  if (scene) return scene.history.revision !== scene.history.savedRevision;
  return selectDirty(useDocumentStore.getState());
}

/**
 * Closing this window would lose something: the document's edits, or those of
 * anything Prefab Mode has set aside. What the dot, Save Scene and the main
 * process's prompts ask.
 */
export function windowUnsaved(): boolean {
  return (
    selectDirty(useDocumentStore.getState()) ||
    selectSetAsideUnsaved(usePrefabModeStore.getState())
  );
}

/**
 * `windowUnsaved`, for a component. Two boolean selectors, so a drag — a
 * mutation every frame — re-renders nothing: the answer moves once.
 */
export function useWindowUnsaved(): boolean {
  const document = useDocumentStore(selectDirty);
  const setAside = usePrefabModeStore(selectSetAsideUnsaved);
  return document || setAside;
}

/**
 * Tells the main process whenever `windowUnsaved` changes, which its close and
 * switch prompts read: it has no other view into the document.
 *
 * A store subscription, reporting in the same call stack as the change. It was
 * a React effect, which runs once the change has rendered: Delete Scene marks
 * the document clean and asks to switch in one go, so the switch reached the
 * main process before "clean" did, and it offered to discard a scene that had
 * just been deleted. Electron delivers one window's messages in the order they
 * were sent, so a report made here arrives first.
 *
 * Reports once when installed, then only when the answer moves, so a drag sends
 * nothing.
 */
export function watchUnsaved(): () => void {
  let reported = windowUnsaved();
  window.studio.project.setDirty(reported);

  const report = (): void => {
    const unsaved = windowUnsaved();
    if (unsaved === reported) return;
    reported = unsaved;
    window.studio.project.setDirty(unsaved);
  };

  const stops = [useDocumentStore.subscribe(report), usePrefabModeStore.subscribe(report)];
  return () => {
    for (const stop of stops) stop();
  };
}
