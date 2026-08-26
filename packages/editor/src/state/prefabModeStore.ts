import { prefabToScene, sceneToPrefab, type SceneDoc } from '@three-studio/core';
import { create } from 'zustand';
import { useAssetStore } from './assetStore';
import { useDocumentStore, type HistoryStash } from './documentStore';
import { useEditorStore } from './editorStore';
import { notify } from './toastStore';

/**
 * Editing one prefab on its own, with what was open set aside.
 *
 * Unity's Prefab Mode, and the reason it is cheap here: a prefab holds
 * `EntityDoc`s, so it *is* a scene once given an environment. The hierarchy,
 * the inspector, the gizmo and the binder all keep working on a `SceneDoc` and
 * none of them learns what a prefab is.
 *
 * A stack rather than a single slot, because a prefab places other prefabs: a
 * room holds a lamp, and reaching that lamp from the room is the same gesture
 * as reaching the room from the scene. Unity keeps the same breadcrumb.
 */

interface PrefabFrame {
  assetId: string;
  name: string;
  /** What to put back when this frame is left — the scene, or the prefab above. */
  scene: SceneDoc;
  selection: readonly string[];
  /**
   * The undo stack of what was set aside, and where its file stood.
   *
   * History is deliberately not shared across the boundary — see `open` — but
   * "not shared" was implemented as "destroyed": a double-click on a prefab
   * threw away an hour of scene undos, which is B4. Set aside and handed back.
   */
  history: HistoryStash;
}

interface PrefabModeState {
  /** Empty when an ordinary scene is open; deepest last. */
  stack: readonly PrefabFrame[];

  /** Opens a prefab on top of whatever is open. */
  open: (assetId: string) => Promise<void>;
  /** Leaves the deepest one, saving it. */
  close: () => Promise<void>;
  /** Leaves everything down to `depth` frames, saving each on the way. */
  closeTo: (depth: number) => Promise<void>;
  /** Back to the scene, however deep. */
  exit: () => Promise<void>;
}

export const usePrefabModeStore = create<PrefabModeState>()((set, get) => ({
  stack: [],

  open: async (assetId) => {
    const prefab = useAssetStore.getState().prefabs[assetId];
    if (!prefab) {
      notify({ kind: 'warning', title: 'That prefab is not in the project' });
      return;
    }

    // A prefab that is already open cannot be opened inside itself. Reachable
    // by hand-editing a file, and a breadcrumb that repeats is a breadcrumb
    // nobody can read their way out of.
    if (get().stack.some((frame) => frame.assetId === assetId)) {
      notify({
        kind: 'warning',
        title: `"${prefab.name}" is already open`,
        description: 'Use the breadcrumb to go back to it.',
      });
      return;
    }

    const document = useDocumentStore.getState();
    const scene = document.scene;
    const selection = useEditorStore.getState().selection;

    // History is not kept across the boundary: an undo in Prefab Mode taking
    // back a scene edit made ten minutes ago is the kind of surprise that
    // costs someone an afternoon. Taken rather than dropped, so leaving gives
    // it back — the prefab starts with an empty stack either way.
    const history = document.takeHistory();

    set({
      stack: [...get().stack, { assetId, name: prefab.name, scene, selection, history }],
    });

    document.replaceScene(prefabToScene(prefab));
    useEditorStore.getState().setSelection([prefab.root]);
  },

  close: () => get().closeTo(get().stack.length - 1),

  closeTo: async (depth) => {
    const target = Math.max(0, depth);

    // Innermost first: each frame stashed the document that was open when it
    // was pushed, so unwinding in the other order would restore a scene that
    // is two edits stale.
    while (get().stack.length > target) {
      const stack = get().stack;
      const frame = stack.at(-1)!;

      const assets = useAssetStore.getState();
      const original = assets.prefabs[frame.assetId];
      if (original) {
        // Saved on the way out rather than on a button. Unity defaults to auto
        // save in Prefab Mode, and the alternative — a mode you can leave
        // having silently lost the last ten minutes — is not worth the toggle.
        await assets.savePrefab(
          frame.assetId,
          sceneToPrefab(useDocumentStore.getState().scene, original),
        );
      }

      set({ stack: stack.slice(0, -1) });
      // `keepHistory`, because this is a restore and not a load: the scene comes
      // back exactly as unsaved as it was left. Then its own stack, which the
      // prefab's has been sitting on top of.
      useDocumentStore.getState().replaceScene(frame.scene, { keepHistory: true });
      useDocumentStore.getState().restoreHistory(frame.history);
      useEditorStore.getState().setSelection([...frame.selection]);
    }
  },

  exit: () => get().closeTo(0),
}));

/** True while a prefab is open, for anything that must behave differently. */
export function inPrefabMode(): boolean {
  return usePrefabModeStore.getState().stack.length > 0;
}

/** The prefab being edited, deepest first open last. `null` in a scene. */
export function currentPrefabFrame(): PrefabFrame | null {
  return usePrefabModeStore.getState().stack.at(-1) ?? null;
}
