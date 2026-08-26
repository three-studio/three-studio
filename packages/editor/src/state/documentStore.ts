import { createEmptyScene, splitInstancedId, validateHierarchy, type SceneDoc } from '@three-studio/core';
import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer';
import { create } from 'zustand';
import { useEditorStore } from './editorStore';

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
const HISTORY_LIMIT = 200;

/**
 * How far back a consumer may fall and still be told precisely what changed.
 *
 * Past this it is told `'*'` and re-reads everything, which is the cheaper
 * answer anyway: merging 256 deltas costs more than one full reconcile, and a
 * consumer that far behind has not drawn a frame in four seconds.
 */
const REVISION_LOG_LIMIT = 256;

/** What one mutation touched. The unit the log is made of. */
interface Change {
  revision: number;
  /** `'*'` means everything: a document was loaded, or the table was replaced. */
  entities: ReadonlySet<string> | '*';
  environment: boolean;
  /**
   * Which asset table moved. No entity did, and yet what is drawn changed.
   *
   * Two flags rather than one, because the two need opposite answers. A material
   * edit invalidates a known set of bindings, and the binder hands that set
   * back. A prefab edit changes what the *expansion produces* — entities appear
   * and vanish — so there is nothing to name and the pass has to be full.
   */
  materials: boolean;
  prefabs: boolean;
}

export interface Changes {
  entities: ReadonlySet<string> | '*';
  environment: boolean;
  materials: boolean;
  prefabs: boolean;
  /** Pass this back as `since` next time. */
  revision: number;
}

/**
 * Work that belongs to an undo step but does not live in the document.
 *
 * Material assets are the reason: they are files, shared by many entities, so
 * editing one changes nothing in the scene — but it is still an edit the user
 * made and expects Cmd+Z to take back. Rather than a second history stack that
 * would interleave wrongly with the first, such an edit rides in the same
 * entry and is replayed by calling back out.
 */
export interface ExternalEdit {
  apply: () => void;
  revert: () => void;
}

/**
 * One user action, whole.
 *
 * `selectionBefore` and `selectionAfter` are not optional, and that is the point:
 * an optional field is a field somebody forgets, which is exactly how undo used
 * to leave the gizmo pointing at an entity it had just deleted (B2). See ADR-4,
 * invariant 2.
 */
interface HistoryEntry {
  label: string;
  patches: Patch[];
  inverse: Patch[];
  selectionBefore: readonly string[];
  selectionAfter: readonly string[];
  /** Non-null while the entry may absorb further edits from the same gesture. */
  coalesceKey: string | null;
  external?: ExternalEdit;
}

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
 * The undo stack and where the file stands, as one value.
 *
 * Taken and put back together by Prefab Mode: opening a prefab sets the scene's
 * history aside instead of destroying it, which is B4. They travel as one
 * because `savedRevision` means nothing without the `revision` it is compared
 * to — restoring one and not the other is how a document ends up permanently
 * dirty, or permanently clean.
 */
export interface HistoryStash {
  past: HistoryEntry[];
  future: HistoryEntry[];
  revision: number;
  savedRevision: number;
}

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

/**
 * Derives which entities a set of immer patches touched.
 *
 * Patch paths look like `['entities', <id>, 'transform', 'position', 1]`, so
 * the affected entity is always at index 1. The binder then re-reads only those
 * entities instead of diffing the whole tree every frame.
 */
function affectedEntities(patches: readonly Patch[]): {
  entities: Set<string>;
  environment: boolean;
  structural: boolean;
  component: boolean;
} {
  const entities = new Set<string>();
  let environment = false;
  let structural = false;
  let component = false;

  for (const patch of patches) {
    const [root, second, third] = patch.path;
    if (root === 'environment') {
      environment = true;
    } else if (root === 'components') {
      /*
       * `['components', <type>, <entityId>, <componentId>, …]` — the entity is
       * at index **2**, not 1. Reading it from 1 would name a component type and
       * wake nothing at all.
       */
      if (typeof third === 'string') entities.add(third);
      else entities.add('*');
      component = true;
      /*
       * Structural only down to the component itself.
       *
       * A path of four segments or fewer adds or removes one — which the
       * hierarchy does show, in the icon `iconFor` picks from `hasComponent`.
       * Anything deeper is a value written *inside* a component, and no list in
       * the editor shows one: dragging a roughness slider used to rebuild the
       * hierarchy's whole row model, a full walk of the scene, sixty times a
       * second to produce an identical list.
       *
       * What that narrowing takes away from the Inspector — whose set of fields
       * *does* turn on values a component holds, a light's `kind`, a mesh's
       * filled texture slots — `componentRevision` gives back.
       */
      if (patch.path.length <= 4) structural = true;
    } else if (root === 'entities' && typeof second === 'string') {
      entities.add(second);
      // A transform is the one thing that changes nothing anyone lists: not the
      // hierarchy rows, not the Inspector's set of fields, not a menu. Every
      // other write may.
      if (third !== 'transform') structural = true;
    } else if (root === 'rootOrder') {
      /*
       * Names no entity at all — and that is not a shortcut.
       *
       * `link`/`unlink` write `rootOrder` for **any** root entity, so adding or
       * deleting a cube at the top level, the commonest gesture in the editor,
       * used to be answered with `'*'` and degenerate into a full reconcile.
       *
       * Nothing has to be named because `rootOrder` is an *ordering*: it decides
       * what the hierarchy lists and in which order, and nothing about what is
       * drawn. Whatever actually appeared, vanished or moved is named by another
       * patch of the same mutation — an `entities.<id>` add or remove, or a
       * change to its `parent`. So the binder needs nothing from here, and the
       * panels need only to know the list changed, which `structural` says.
       */
      structural = true;
    } else if (root === 'entities') {
      // A whole-table replacement names nothing: the binder must resync fully.
      entities.add('*');
      structural = true;
    }
  }

  return { entities, environment, structural, component };
}

/**
 * Collapses repeated writes to the same path down to one.
 *
 * A ten-second drag at 60fps leaves ~600 patch/inverse pairs in a single
 * coalesced entry, none of which will ever be reduced (ADR-4, invariant 6). Each
 * frame overwrites the same `transform.position`, so all but one of them are
 * dead weight — kept in memory, walked by `affectedEntities`, and copied on
 * every subsequent mutation of the gesture.
 *
 * The surviving patch keeps the **position of the first** and the **value of the
 * last**, which is correct for both directions: applied in order, the last
 * writer to a path wins, and an inverse array is stored oldest-last, so its last
 * occurrence is the oldest value — the one an undo must land on.
 *
 * Only when every patch is a `replace`. An `add` or a `remove` on an array moves
 * the indices its neighbours refer to, so reordering around one changes what the
 * patches mean. A drag produces nothing but `replace`, which is the case this is
 * for; anything else is left exactly as it came.
 */
function compact(patches: Patch[]): Patch[] {
  if (patches.length < 2) return patches;
  if (!patches.every((patch) => patch.op === 'replace')) return patches;

  const out: Patch[] = [];
  const seen = new Map<string, number>();
  for (const patch of patches) {
    const key = patch.path.join(' ');
    const at = seen.get(key);
    if (at === undefined) {
      seen.set(key, out.length);
      out.push(patch);
    } else {
      out[at] = patch;
    }
  }
  return out;
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

/**
 * The revision log.
 *
 * Deliberately outside the zustand state. Nothing renders from it — consumers
 * ask it a question and remember the answer — and putting it in the store would
 * hand every subscriber a new array on every mutation, which is the kind of
 * per-frame wake-up this project keeps finding and removing.
 *
 * Its counter is **strictly increasing**, which the store's `revision` is not:
 * that one is the save marker and goes back down on undo (phase 2). Two ideas,
 * two numbers — sharing one would make an undo look like a rewind of the log.
 */
const log = {
  entries: [] as Change[],
  next: 1,

  append(change: Omit<Change, 'revision'>): void {
    this.entries.push({ ...change, revision: this.next });
    this.next += 1;
    if (this.entries.length > REVISION_LOG_LIMIT) {
      this.entries.splice(0, this.entries.length - REVISION_LOG_LIMIT);
    }
  },

  since(revision: number): Changes {
    const current = this.next - 1;
    const oldest = this.entries[0]?.revision;

    // Nothing kept from that far back — or nothing kept at all, on a store that
    // has just been replaced. Either way the honest answer is "re-read".
    if (oldest === undefined) {
      return {
        entities: revision === current ? new Set() : '*',
        environment: false,
        materials: false,
        prefabs: false,
        revision: current,
      };
    }
    if (revision < oldest - 1) {
      return { entities: '*', environment: true, materials: true, prefabs: true, revision: current };
    }

    const entities = new Set<string>();
    let everything = false;
    let environment = false;
    let materials = false;
    let prefabs = false;

    for (const entry of this.entries) {
      if (entry.revision <= revision) continue;
      if (entry.entities === '*') everything = true;
      else for (const id of entry.entities) entities.add(id);
      environment ||= entry.environment;
      materials ||= entry.materials;
      prefabs ||= entry.prefabs;
    }

    return { entities: everything ? '*' : entities, environment, materials, prefabs, revision: current };
  },

  reset(): void {
    this.entries.length = 0;
    this.next = 1;
  },
};

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

    const coalesceKey = options?.coalesceKey ?? null;
    const previous = state.past.at(-1);
    const canCoalesce =
      coalesceKey !== null && previous !== undefined && previous.coalesceKey === coalesceKey;

    const entry: HistoryEntry = canCoalesce
      ? {
          label: previous.label,
          patches: compact([...previous.patches, ...patches]),
          // Inverse patches undo in reverse order, so the older ones go last.
          inverse: compact([...inverse, ...previous.inverse]),
          // The gesture began where the first mutation of it began: one undo has
          // to reach the start of the drag, not its second frame.
          selectionBefore: previous.selectionBefore,
          selectionAfter,
          coalesceKey,
          external: previous.external,
        }
      : {
          label,
          patches: [...patches],
          inverse: [...inverse],
          selectionBefore,
          selectionAfter,
          coalesceKey,
          external: options?.external,
        };

    const past = canCoalesce ? [...state.past.slice(0, -1), entry] : [...state.past, entry];
    const touched = affectedEntities(patches);
    assertHierarchy(scene, patches, label);
    log.append({
      entities: touched.entities.has('*') ? '*' : touched.entities,
      environment: touched.environment,
      materials: false,
      prefabs: false,
    });

    set({
      scene,
      past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
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
    const past = [...state.past, entry];
    set({
      past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
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

    const touched = affectedEntities(entry.inverse);
    const scene = applyPatches(state.scene, entry.inverse);
    // An undo is a change like any other: its delta is that of its inverse
    // patches.
    log.append({
      entities: touched.entities.has('*') ? '*' : touched.entities,
      environment: touched.environment,
      materials: false,
      prefabs: false,
    });
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
      // counter keeps climbing — see `log`.
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

    const touched = affectedEntities(entry.patches);
    const scene = applyPatches(state.scene, entry.patches);
    assertHierarchy(scene, entry.patches, `redo ${entry.label}`);
    log.append({
      entities: touched.entities.has('*') ? '*' : touched.entities,
      environment: touched.environment,
      materials: false,
      prefabs: false,
    });

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
      log.append({ entities: '*', environment: true, materials: true, prefabs: true });

      return {
        scene,
        past: restoring ? state.past : [],
        future: restoring ? state.future : [],
        ...marker,
        structureRevision: state.structureRevision + 1,
        // A different document holds different components, whatever the old one
        // held. Both counters move for the same reason the log gets a `'*'`.
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

  changesSince: (since) => log.since(since),
  noteLibraryChange: (table) =>
    log.append({
      entities: new Set(),
      environment: false,
      materials: table === 'materials',
      prefabs: table === 'prefabs',
    }),

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
  undoLabel: () => get().past.at(-1)?.label ?? null,
  redoLabel: () => get().future[0]?.label ?? null,
}));
