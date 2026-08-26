import {
  PREFAB_ID_SEPARATOR,
  applyPrefabOverride,
  collectDescendants,
  componentsOf,
  createEntity,
  createId,
  createPrefabInstance,
  deleteComponent,
  dropComponentsOf,
  expandPrefabs,
  findPrefabInstances,
  insertEntity,
  instanceOwnerOf,
  prefabFromEntities,
  prefabInstanceOf,
  prefabVariantOf,
  setComponentsOf,
  splitInstancedId,
  type EntityDoc,
  type PrefabDoc,
  type PrefabInstanceComponent,
} from '@three-studio/core';
import { useAssetStore } from '../state/assetStore';
import { useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import { askForText } from '../state/dialogStore';
import { notify } from '../state/toastStore';

/**
 * Turns a selected entity and its children into a prefab asset, and replaces
 * it in the scene with an instance of that asset.
 *
 * Unity's "drag into the Project window", and it does the same two things at
 * once: writes the asset, then makes what you had into the first instance of
 * it. Leaving the original as loose entities would mean editing the prefab did
 * nothing to the thing you made it from, which nobody expects.
 */
export async function createPrefabFromEntity(entityId: string): Promise<void> {
  const scene = useDocumentStore.getState().scene;
  const entity = scene.entities[entityId];
  if (!entity) return;

  const name = await askForText({
    title: 'Create Prefab',
    label: 'Name',
    defaultValue: entity.name,
    confirmLabel: 'Create',
  });
  if (name === null) return;

  try {
    const prefab = prefabFromEntities(name, scene, entityId);
    const assetId = await useAssetStore.getState().createPrefab(name, prefab);
    const path = useAssetStore.getState().byId(assetId)?.path ?? null;

    useDocumentStore.getState().mutate(
      'Create prefab',
      (draft) => {
        const target = draft.entities[entityId];
        if (!target) return;

        // The sub-tree lives in the asset now; the scene keeps one entity that
        // points at it, and the transform that says where it stands.
        for (const id of collectDescendants(draft, entityId)) {
          delete draft.entities[id];
          dropComponentsOf(draft, id);
        }
        target.children = [];
        setComponentsOf(draft, entityId, [createPrefabInstance(assetId)]);
      },
      {
        // Undoing the creation has to take the file back too, or the project
        // collects a prefab nothing points at every time someone changes their
        // mind. Redo writes it again under the *same* id — a fresh one would
        // leave the entity, restored by the undo patches, naming a prefab that
        // no longer answers to it.
        external: {
          apply: () => {
            void useAssetStore.getState().createPrefab(name, prefab, assetId);
          },
          revert: () => {
            if (path !== null) void useAssetStore.getState().remove(path);
          },
        },
      },
    );

    notify({ kind: 'success', title: `Prefab "${name}" created`, description: entity.name });
  } catch (cause) {
    notify({
      kind: 'error',
      title: 'Could not create the prefab',
      description: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

/**
 * Places an instance of a prefab, optionally at a point in the world and under a
 * parent.
 *
 * `parentId` is new here: this used to push straight into `rootOrder`, its own
 * copy of what `insertEntity` does, so an instance could only ever be dropped at
 * the top of the scene.
 */
export function instantiatePrefab(
  assetId: string,
  position: [number, number, number] = [0, 0, 0],
  parentId: string | null = null,
): void {
  const prefab = useAssetStore.getState().prefabs[assetId];
  const template = createEntity(prefab?.name ?? 'Prefab', [createPrefabInstance(assetId)]);
  template.entity.transform.position = position;

  useDocumentStore.getState().mutate('Add prefab', (draft) => {
    insertEntity(draft, template, parentId);
  });
  useEditorStore.getState().setSelection([template.entity.id]);
}

/**
 * Makes a prefab that is a variant of another.
 *
 * Unity's Prefab Variant: a red barrel that follows every change to the barrel
 * but keeps its own colour. It needs nothing new from the expansion — a prefab
 * whose root is an instance of another prefab already behaves exactly this way.
 *
 * The variant starts identical. What makes it differ is opened in Prefab Mode
 * and overridden there, which is where an override on a nested instance can be
 * reached at all.
 */
export async function createPrefabVariant(baseAssetId: string): Promise<string | null> {
  const base = useAssetStore.getState().prefabs[baseAssetId];
  if (!base) {
    notify({ kind: 'warning', title: 'That prefab is not in the project' });
    return null;
  }

  const name = await askForText({
    title: 'Create Prefab Variant',
    label: 'Name',
    defaultValue: `${base.name} Variant`,
    confirmLabel: 'Create',
  });
  if (name === null) return null;

  try {
    const variant = prefabVariantOf(name, base, baseAssetId);
    const assetId = await useAssetStore.getState().createPrefab(name, variant);
    notify({
      kind: 'success',
      title: `Variant "${name}" created`,
      description: `Follows "${base.name}" until you override something.`,
    });
    return assetId;
  } catch (cause) {
    notify({
      kind: 'error',
      title: 'Could not create the variant',
      description: cause instanceof Error ? cause.message : String(cause),
    });
    return null;
  }
}

/**
 * Puts one entity of an instance back the way its prefab has it.
 *
 * The counterpart to an override, and Unity's own answer to the complaint that
 * overrides accumulate invisibly: what can be changed per instance has to be
 * undoable per instance, or the prefab stops being the source of truth in
 * practice while still claiming to be one.
 */
export function revertEntityOverride(expandedId: string): void {
  const parts = splitInstancedId(expandedId);
  if (!parts) return;

  useDocumentStore.getState().mutate('Revert override', (draft) => {
    const component =
      draft.entities[parts.owner] === undefined
        ? undefined
        : prefabInstanceOf(draft, parts.owner);
    if (component) delete component.overrides[parts.local];
  });
}

/**
 * Pushes an instance's overrides into the prefab asset, so every other instance
 * gets them too.
 *
 * The half of "edit a prefab" that matters. Without it the only way to change
 * one was to unpack, edit and re-create — which breaks the link on every other
 * instance, the exact thing a prefab exists to prevent. Unity calls it Apply
 * All; a full Prefab Mode is the same idea with an isolated view on top.
 */
export async function applyInstanceOverrides(entityId: string): Promise<void> {
  const scene = useDocumentStore.getState().scene;
  const component =
    scene.entities[entityId] === undefined ? undefined : prefabInstanceOf(scene, entityId);
  if (!component) return;

  const prefab = useAssetStore.getState().prefabs[component.assetId];
  if (!prefab) {
    notify({
      kind: 'warning',
      title: 'Nothing to apply to',
      description: 'This instance points at a prefab that is not in the project.',
    });
    return;
  }

  const count = Object.keys(component.overrides).length;
  if (count === 0) {
    notify({ kind: 'info', title: 'No overrides to apply' });
    return;
  }

  const before = structuredClone(prefab);
  const after = structuredClone(prefab);
  for (const [localId, override] of Object.entries(component.overrides)) {
    // A key with a path is about something a prefab *this* prefab places, so it
    // belongs on that placement rather than on an entity here — pushed one
    // level in, where the next expansion will read it.
    const separator = localId.indexOf(PREFAB_ID_SEPARATOR);
    if (separator !== -1) {
      const nestedId = localId.slice(0, separator);
      const inner =
        after.entities[nestedId] === undefined ? undefined : prefabInstanceOf(after, nestedId);
      if (inner) inner.overrides[localId.slice(separator + 1)] = structuredClone(override);
      continue;
    }

    const entity = after.entities[localId];
    if (!entity) continue; // The prefab was restructured; drop the stale override.

    setComponentsOf(after, localId, applyPrefabOverride(entity, componentsOf(after, localId), override));
    // Where the root sits is the placement, not the shape: applying it would
    // move every instance of the prefab to wherever this one happens to stand.
    // Unity draws the line in the same place, and on the same side of scale —
    // how big the thing is belongs to the prefab.
    if (localId === after.root) {
      const original = before.entities[localId]!.transform;
      entity.transform = { ...entity.transform, position: original.position, rotation: original.rotation };
    }
  }

  const write = (doc: PrefabDoc) => {
    void useAssetStore.getState().savePrefab(component.assetId, doc);
  };
  write(after);

  useDocumentStore.getState().mutate(
    'Apply prefab overrides',
    (draft) => {
      const target =
        draft.entities[entityId] === undefined ? undefined : prefabInstanceOf(draft, entityId);
      // Cleared, not kept: they are the prefab's values now, and an override
      // that repeats what it overrides is the thing that later looks like a
      // change nobody made.
      if (target) target.overrides = {};
    },
    // One step. Writing the asset and clearing what it replaced is one action
    // to the user, and two entries would need two Cmd+Z to undo cleanly.
    { external: { apply: () => write(after), revert: () => write(before) } },
  );

  const instances = findPrefabInstances(component.assetId, scene).length;
  notify({
    kind: 'success',
    title: `Applied to "${prefab.name}"`,
    description: `${count} override${count === 1 ? '' : 's'}, now on ${instances} instance${instances === 1 ? '' : 's'}.`,
  });
}

/** Drops every override on an instance, restoring the prefab as authored. */
export function revertInstanceOverrides(entityId: string): void {
  const count = Object.keys(overridesOf(entityId)).length;
  if (count === 0) return;

  useDocumentStore.getState().mutate('Revert prefab overrides', (draft) => {
    const component =
      draft.entities[entityId] === undefined ? undefined : prefabInstanceOf(draft, entityId);
    if (component) component.overrides = {};
  });
  notify({ kind: 'success', title: `Reverted ${count} override${count === 1 ? '' : 's'}` });
}

/**
 * The prefab an instance points at, and every other entity placing the same one.
 *
 * `null` for anything that is not an instance, so callers can use it as the
 * test for "does this row get prefab actions at all".
 */
export function instanceInfo(
  entityId: string,
): { assetId: string; name: string; siblings: string[]; missing: boolean } | null {
  const scene = useDocumentStore.getState().scene;
  const component =
    scene.entities[entityId] === undefined ? undefined : prefabInstanceOf(scene, entityId);
  if (!component) return null;

  const prefab = useAssetStore.getState().prefabs[component.assetId];
  return {
    assetId: component.assetId,
    name: prefab?.name ?? 'Missing prefab',
    siblings: findPrefabInstances(component.assetId, scene),
    missing: prefab === undefined,
  };
}

/**
 * Selects every instance of the same prefab.
 *
 * Unity's "Select Instances", and the answer to the question anyone asks before
 * editing a prefab: what exactly am I about to change.
 */
export function selectPrefabInstances(entityId: string): void {
  const info = instanceInfo(entityId);
  if (!info) return;

  useEditorStore.getState().setSelection(info.siblings);
  notify({
    kind: 'info',
    title: `${info.siblings.length} instance${info.siblings.length === 1 ? '' : 's'} of "${info.name}"`,
  });
}

/** The overrides an instance carries, empty for anything that is not one. */
export function overridesOf(entityId: string): Record<string, unknown> {
  const scene = useDocumentStore.getState().scene;
  if (scene.entities[entityId] === undefined) return {};
  return prefabInstanceOf(scene, entityId)?.overrides ?? {};
}

/**
 * Replaces an instance with ordinary entities, as Unity's "Unpack Prefab" does.
 *
 * One-way on purpose. The contents stop following the asset, which is the point
 * — the alternative, a link that is sometimes live, is the thing nobody can
 * reason about later.
 */
export function unpackPrefabInstance(entityId: string): void {
  const document = useDocumentStore.getState();
  const host = document.scene.entities[entityId];
  const component = host === undefined ? undefined : prefabInstanceOf(document.scene, entityId);
  if (!host || !component) return;

  const prefab = useAssetStore.getState().prefabs[component.assetId];
  if (!prefab) {
    notify({
      kind: 'warning',
      title: 'Nothing to unpack',
      description: 'This instance points at a prefab that is not in the project.',
    });
    return;
  }

  // Expanded with the same function the runtime uses, on a scene holding only
  // this instance. Rebuilding the walk here would be a second implementation
  // of the thing that decides what an instance looks like.
  const { scene: expanded } = expandPrefabs(
    { ...document.scene, entities: { [entityId]: host }, rootOrder: [entityId] },
    { get: (id) => useAssetStore.getState().prefabs[id] },
  );
  const owned = Object.values(expanded.entities).filter(
    (entity) => instanceOwnerOf(entity.id) === entityId,
  );

  // One level, as Unity's "Unpack Prefab" does — a prefab this one places stays
  // an instance. Its contents are still in `owned`, and re-expand from the
  // component the host keeps, so writing them out too would double them.
  const nestedHosts = owned
    .filter((entity) => prefabInstanceOf(expanded, entity.id) !== undefined)
    .map((entity) => `${entity.id}${PREFAB_ID_SEPARATOR}`);
  const produced = owned.filter((entity) => !nestedHosts.some((h) => entity.id.startsWith(h)));

  document.mutate('Unpack prefab', (draft) => {
    const target = draft.entities[entityId];
    if (!target) return;

    // The instance component goes; everything else the author put on the host
    // stays, which is what "unpack" means.
    for (const instance of Object.values(draft.components.prefabInstance[entityId] ?? {})) {
      deleteComponent(draft, entityId, instance.id);
    }

    // Fresh ids. An expanded id names the instance it came from, and these
    // entities no longer belong to one — keeping it would leave every reader of
    // `instanceOwnerOf` pointing at an instance that does not exist any more.
    const renamed = new Map(produced.map((entity) => [entity.id, createId()]));
    const rename = (id: string) => renamed.get(id) ?? id;

    for (const entity of produced) {
      const copy: EntityDoc = structuredClone(entity);
      copy.id = rename(copy.id);
      copy.parent = copy.parent === null ? null : rename(copy.parent);
      copy.children = copy.children.map(rename);
      draft.entities[copy.id] = copy;
      // Read from the expansion, not from the draft: these entities only exist
      // in the expanded scene, and their components with them.
      setComponentsOf(draft, copy.id, structuredClone(componentsOf(expanded, entity.id)));

      // Appended, never assigned: whatever the author parented under the
      // instance is already in `children` and is not ours to drop.
      if (entity.parent === entityId) target.children.push(copy.id);
    }
  });

  notify({ kind: 'success', title: `Unpacked "${prefab.name}"` });
}
