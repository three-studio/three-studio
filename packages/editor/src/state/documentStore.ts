import { createEmptyScene, splitInstancedId, validateHierarchy, type SceneDoc } from '@three-studio/core';
import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer';
import { create } from 'zustand';
import { useEditorStore } from './editorStore';
import { pushEdit, type ExternalEdit, type HistoryEntry, type HistoryStash } from './history';
import { revisionLog, type Changes } from './revisionLog';

/*
 * The document, and nothing else. Its history is `history.ts` and what changed
 * when is `revisionLog.ts` — six hundred lines of one file were three jobs that
 * only ever met here, in `mutate`.
 */

export type { Changes } from './revisionLog';
export type { ExternalEdit, HistoryStash } from './history';

export interface MutationOptions {
  /**
   * Consecutive mutations sharing a key collapse into one history entry. Used
   * by gizmo drags and slider scrubs, which otherwise produce hundreds of
   * undo steps for a single user gesture.
   */
  coalesceKey?: string;
  /**
   * An edit outside the document that must be taken back with this one, in a
   * single step. Writing an asset and clearing what it replaced are one action
   * to the user; two history entries would need two Cmd+Z.
   */
  external?: ExternalEdit;
  /**
   * What is selected once this has happened, applied inside the transaction.
   *
   * The function form is for commands that only learn the new ids from their own
   * recipe — `duplicateEntities` above all. It is handed the scene the recipe
   * produced, not the one it started from.
   *
   * Setting the selection *after* `mutate` is what B2 was: the change was not in
   * the entry, so undo could not take it back.
   */
  select?: readonly string[] | ((scene: SceneDoc) => readonly string[]);
}

/**
 * Drops selected ids that no longer name anything.
 *
 * Checked against the document rather than the expanded scene, on purpose: an
 * expanded id (`owner/local`) is not in `scene.entities` and would all be thrown
 * away, which is every selection made inside a prefab. What is asked instead is
 * whether the instance that produces it is still there. That keeps an id whose
 * `local` half no longer resolves — coarser, but wrong in the harmless
 * direction, where the alternative clears a selection the user can see.
 */
function pruneSelection(scene: SceneDoc, selection: readonly string[]): readonly string[] {
  const kept = selection.filter((id) => {
    const parts = splitInstancedId(id);
    return scene.entities[parts === null ? id : parts.owner] !== undefined;
  });
  // Same array when nothing went, so subscribers do not see a change.
  return kept.length === selection.length ? selection : kept;
}

enablePatches();

/**
 * Whether a patch set could have changed the shape of the tree.
 *
 * Only three things can: `rootOrder`, an entity's `parent` or `children`, and an
 * entity appearing or disappearing (a two-segment path under `entities`). A
 * gizmo drag writes `entities.<id>.transform.position` and nothing else, so it
 * cannot break an edge — which is what makes the check below free on the one
 * path that runs every frame.
 */
function touchesHierarchy(patches: readonly Patch[]): boolean {
  return patches.some((patch) => {
    const [root, , third] = patch.path;
    if (root === 'rootOrder') return true;
    if (root !== 'entities') return false;
    // `['entities']` replaces the table; `['entities', id]` adds or removes one.
    if (patch.path.length <= 2) return true;
    return third === 'parent' || third === 'children';
  });
}

/**
 * Shouts in development when a mutation left the hierarchy inconsistent.
 *
 * The three stored copies of the tree — `parent`, `children[]`, `rootOrder` —
 * used to be checked only by `repairHierarchy`, at load. An edit that broke an
 * edge stayed broken all session and was quietly healed on the next open, which
 * is why B1 survived so long: nothing said anything until the evidence was gone.
 *
 * Console rather than a throw. A half-written document is not worth losing the
 * session over, and `graph.ts` refuses the operations that would cause this — so
 * anything reaching here is a path that bypassed it, which is exactly what wants
 * naming out loud.
 *
 * Development only, and only for a patch set that touched the tree. Both halves
 * were measured rather than assumed: validating every mutation cost 0.8ms of a
 * 13ms frame at 2000 entities, on a drag that cannot break an edge in the first
 * place — see the phase 1 entry in `docs/refonte-scene/JOURNAL.md`.
 */
function assertHierarchy(scene: SceneDoc, patches: readonly Patch[], label: string): void {
  if (!import.meta.env.DEV || !touchesHierarchy(patches)) return;
  const problems = validateHierarchy(scene);
  if (problems.length === 0) return;
  console.error(`[document] "${label}" left the hierarchy inconsistent:\n  ${problems.join('\n  ')}`);
}

/** How much history is kept. Each entry holds patches, not scene snapshots. */


interface DocumentState {
  scene: SceneDoc;
  past: HistoryEntry[];
  future: HistoryEntry[];
  /**
   * Bumped by every change to the document. Not monotonic across a Prefab Mode
   * round trip, which restores the pair below wholesale.
   */
  revision: number;
  /**
   * The revision that is on disk. `revision !== savedRevision` is what "unsaved"
   * means — a marker rather than a boolean, because with a boolean undoing back
   * to the last save leaves the document marked modified for ever (B3).
   */
  savedRevision: number;
  /**
   * Bumped only by a change that alters what something *lists*: an entity added
   * or removed, renamed, hidden, reparented, given a component.
   *
   * A transform does not, and neither does a value written *inside* a component
   * — see `affectedEntities`. The hierarchy's row model, which is a full walk of
   * the scene, used to be rebuilt on every mutation because its memo depended on
   * `scene` — so dragging one cube rebuilt two thousand rows sixty times a
   * second to produce exactly the same list. Panels depend on this instead.
   */
  structureRevision: number;
  /**
   * Bumped by any write under `components`, however deep.
   *
   * The Inspector's signal, and the reason it is not `structureRevision`: a
   * component lives in `scene.components`, not in its entity, so **nothing about
   * the `EntityDoc` moves when one is added, edited or removed**. The panel
   * watched the entity and therefore showed a component only once something else
   * — a gizmo drag, a reselection — happened to wake it.
   *
   * Separate from `structureRevision` because the two want opposite answers. A
   * roughness slider must reach the Inspector sixty times a second and must not
   * reach the hierarchy at all, whose rows show nothing that moved.
   */
  componentRevision: number;

  /** The only way to change the scene. Everything else is a wrapper over this. */
  mutate: (label: string, recipe: (draft: SceneDoc) => void, options?: MutationOptions) => void;
  /**
   * Adds an undo step for an edit that happened outside the document. The edit
   * itself has already been applied; this only records how to take it back.
   */
  recordExternal: (label: string, external: ExternalEdit) => void;
  undo: () => void;
  redo: () => void;
  /**
   * Replace the document wholesale.
   *
   * `keepHistory` says which of two very different things this is. Without it,
   * a new document is being loaded: history goes, and the result is clean
   * because it is what the file holds. With it, a document that was set aside is
   * being *restored* — Play/Stop, leaving Prefab Mode — and a restore decides
   * nothing about whether the work is saved. Forcing `dirty: false` in both
   * cases was B3, and it lost unsaved work with no warning.
   */
  replaceScene: (scene: SceneDoc, options?: { keepHistory?: boolean }) => void;
  /** Records that what is in the document is now what is on disk. */
  markClean: () => void;
  /** Takes the undo stack away, for a caller that will put it back. */
  takeHistory: () => HistoryStash;
  restoreHistory: (stash: HistoryStash) => void;
  /**
   * What has changed since `since`, and the revision that answer is good for.
   *
   * Replaces a drained buffer that every consumer shared. `clearDirtyEntities()`
   * was a global `set()`, so **the first consumer to run emptied the information
   * for all the others** — with one viewport nothing broke, and a second one, or
   * a panel dockview remounts, was impossible by construction.
   *
   * Nobody clears anything now: each consumer remembers its own `since` and the
   * log answers all of them independently.
   */
  changesSince: (since: number) => Changes;
  /** Called by the asset store when one of the asset tables moves. */
  noteLibraryChange: (table: 'materials' | 'prefabs') => void;

  canUndo: () => boolean;
  canRedo: () => boolean;
  undoLabel: () => string | null;
  redoLabel: () => string | null;
}

/*
 * Selectors, for components.
 *
 * A component that subscribes to `past` re-renders on every mutation, which
 * during a gizmo drag means every frame — the array's identity changes even when
 * a coalesced entry only grew. These return a string or a boolean, so zustand's
 * equality check stops the re-render instead of the component doing it.
 */
export const selectDirty = (state: DocumentState): boolean =>
  state.revision !== state.savedRevision;
export const selectCanUndo = (state: DocumentState): boolean => state.past.length > 0;
export const selectCanRedo = (state: DocumentState): boolean => state.future.length > 0;
export const selectUndoLabel = (state: DocumentState): string | null =>
  state.past.at(-1)?.label ?? null;
export const selectRedoLabel = (state: DocumentState): string | null =>
  state.future[0]?.label ?? null;



export const useDocumentStore = create<DocumentState>()((set, get) => ({
  scene: createEmptyScene(),
  past: [],
  future: [],
  revision: 0,
  savedRevision: 0,
  structureRevision: 0,
  componentRevision: 0,

  mutate: (label, recipe, options) => {
    const state = get();
    const [scene, patches, inverse] = produceWithPatches(state.scene, recipe);
    if (patches.length === 0) {
      // The document did not move, but the world outside it did — that still
      // has to be undoable.
      if (options?.external) get().recordExternal(label, options.external);
      return;
    }

    const selectionBefore = useEditorStore.getState().selection;
    const asked =
      typeof options?.select === 'function' ? options.select(scene) : options?.select;
    const selectionAfter = pruneSelection(scene, asked ?? selectionBefore);

    const past = pushEdit(state.past, {
      label,
      patches: [...patches],
      inverse: [...inverse],
      selectionBefore,
      selectionAfter,
      coalesceKey: options?.coalesceKey ?? null,
      external: options?.external,
    });
    assertHierarchy(scene, patches, label);
    const touched = revisionLog.note(patches);

    set({
      scene,
      past,
      future: [],
      revision: state.revision + 1,
      structureRevision: state.structureRevision + (touched.structural ? 1 : 0),
      componentRevision: state.componentRevision + (touched.component ? 1 : 0),
    });

    // After the document, never before: a subscriber woken by the selection
    // would otherwise read the new ids against the old scene and render an
    // entity that does not exist there yet.
    if (selectionAfter !== selectionBefore) useEditorStore.getState().setSelection(selectionAfter);
  },

  recordExternal: (label, external) => {
    const state = get();
    // Carries a selection like any other entry: without one, undoing a material
    // edit would leave whatever the previous entry happened to select.
    const selection = useEditorStore.getState().selection;
    const entry: HistoryEntry = {
      label,
      patches: [],
      inverse: [],
      selectionBefore: selection,
      selectionAfter: selection,
      coalesceKey: null,
      external,
    };
    set({
      past: pushEdit(state.past, entry),
      future: [],
      // An external edit is unsaved work too — it wrote a file, and the entry
      // that would take it back is only in memory.
      revision: state.revision + 1,
    });
  },

  undo: () => {
    const state = get();
    const entry = state.past.at(-1);
    if (!entry) return;

    entry.external?.revert();

    const scene = applyPatches(state.scene, entry.inverse);
    // An undo is a change like any other: its delta is that of its inverse
    // patches.
    const touched = revisionLog.note(entry.inverse);
    // Checked on the way back too: an inverse patch set restores a shape nobody
    // wrote by hand, and taking back a structural edit is where an inconsistency
    // would first show.
    assertHierarchy(scene, entry.inverse, `undo ${entry.label}`);

    set({
      scene,
      past: state.past.slice(0, -1),
      future: [entry, ...state.future],
      // Down, not up: this is what lets undoing back to the last save report the
      // document as saved again, which a boolean could never do. The log's own
      // counter keeps climbing — see `revisionLog`.
      revision: state.revision - 1,
      structureRevision: state.structureRevision + (touched.structural ? 1 : 0),
      componentRevision: state.componentRevision + (touched.component ? 1 : 0),
    });

    // Pruned as well as restored: the entry recorded what was selected before
    // the edit, and undoing an edit that came *after* a delete can name an
    // entity this scene no longer holds.
    useEditorStore.getState().setSelection(pruneSelection(scene, entry.selectionBefore));
  },

  redo: () => {
    const state = get();
    const [entry, ...rest] = state.future;
    if (!entry) return;

    entry.external?.apply();

    const scene = applyPatches(state.scene, entry.patches);
    assertHierarchy(scene, entry.patches, `redo ${entry.label}`);
    const touched = revisionLog.note(entry.patches);

    set({
      scene,
      past: [...state.past, entry],
      future: rest,
      revision: state.revision + 1,
      structureRevision: state.structureRevision + (touched.structural ? 1 : 0),
      componentRevision: state.componentRevision + (touched.component ? 1 : 0),
    });

    useEditorStore.getState().setSelection(pruneSelection(scene, entry.selectionAfter));
  },

  replaceScene: (scene, options) =>
    set((state) => {
      const restoring = options?.keepHistory === true;
      // A load is clean by definition; a restore says nothing about it, so both
      // numbers travel unchanged and `dirty` comes out the way it went in.
      const marker = restoring
        ? { revision: state.revision, savedRevision: state.savedRevision }
        : { revision: 0, savedRevision: 0 };

      // `'*'`, not an ordinary entry: every consumer must re-read whatever its
      // own `since` is, and a delta cannot express "this is a different
      // document".
      revisionLog.noteWholeDocument();

      return {
        scene,
        past: restoring ? state.past : [],
        future: restoring ? state.future : [],
        ...marker,
        structureRevision: state.structureRevision + 1,
        // A different document holds different components, whatever the old one
        // held. Both counters move for the same reason the revision log is told
        // the whole document changed.
        componentRevision: state.componentRevision + 1,
      };
    }),

  markClean: () => set((state) => ({ savedRevision: state.revision })),

  takeHistory: () => {
    const state = get();
    const stash: HistoryStash = {
      past: state.past,
      future: state.future,
      revision: state.revision,
      savedRevision: state.savedRevision,
    };
    set({ past: [], future: [], revision: 0, savedRevision: 0 });
    return stash;
  },

  restoreHistory: (stash) =>
    set({
      past: stash.past,
      future: stash.future,
      revision: stash.revision,
      savedRevision: stash.savedRevision,
    }),

  changesSince: (since) => revisionLog.since(since),
  noteLibraryChange: (table) => revisionLog.noteLibrary(table),

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
  undoLabel: () => get().past.at(-1)?.label ?? null,
  redoLabel: () => get().future[0]?.label ?? null,
}));
