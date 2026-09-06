import type { Patch } from 'immer';

/*
 * What changed, since when, and for whom.
 *
 * Lifted out of `documentStore`, which was 704 lines and six jobs. This is the
 * one that answers a question rather than holding state a panel renders: a
 * consumer says how far behind it is and is told what to re-read.
 */

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
export const revisionLog = {
  entries: [] as Change[],
  next: 1,

  /**
   * Records what a patch set touched, and answers what the store's own counters
   * need to know.
   *
   * One call rather than the four-line `append({ entities: touched.entities.has(
   * '*') ? … })` that `mutate`, `undo` and `redo` each wrote out identically.
   * The two flags come back because they are the *store's* — a structural
   * change and a component change each drive a counter a panel subscribes to,
   * and neither is any business of the log.
   */
  note(patches: readonly Patch[]): { structural: boolean; component: boolean } {
    const touched = affectedEntities(patches);
    this.append({
      entities: touched.entities.has('*') ? '*' : touched.entities,
      environment: touched.environment,
      materials: false,
      prefabs: false,
    });
    return { structural: touched.structural, component: touched.component };
  },

  /** A different document: every consumer re-reads, whatever its own `since`. */
  noteWholeDocument(): void {
    this.append({ entities: '*', environment: true, materials: true, prefabs: true });
  },

  /** A shared asset table moved. No entity did, and yet what is drawn changed. */
  noteLibrary(table: 'materials' | 'prefabs'): void {
    this.append({
      entities: new Set(),
      environment: false,
      materials: table === 'materials',
      prefabs: table === 'prefabs',
    });
  },

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

