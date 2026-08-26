import {
  cloneSubtree,
  componentsOf,
  splitInstancedId,
  createComponentForEntity,
  createEntity,
  deleteComponent,
  findComponentById,
  insertEntity,
  isAncestorOf,
  putComponent,
  removeSubtree,
  reparentEntity as reparentInScene,
  type ComponentDoc,
  type ComponentType,
  type EntityTemplate,
  type MaterialDef,
  type SceneDoc,
  type Transform,
} from '@three-studio/core';
import type { Matrix4 } from 'three/webgpu';
import { useAssetStore } from '../state/assetStore';
import { useDocumentStore, type MutationOptions } from '../state/documentStore';
import { Selection } from '../state/selection';
import { useEditorStore } from '../state/editorStore';
import { notify } from '../state/toastStore';
import { editInstance, overrideComponentPath } from './prefabOverrides';
import {
  localTransformAfterDelta,
  localTransformUnder,
  transformFromMatrix,
  translationMatrix,
  worldMatrix,
  worldPosition,
} from './transformSpace';

/*
 * Every scene edit lives here as a named operation.
 *
 * They all funnel through `documentStore.mutate`, which records immer patches
 * and their inverses — so undo/redo is automatic and no operation has to write
 * its own inverse.
 */

/*
 * One door, carrying everything. It used to take a bare `coalesceKey` and drop
 * `external` on the floor — two ways in, one of which lost information, which is
 * the first of ADR-4's nine invariants.
 */
const mutate = (
  label: string,
  recipe: (draft: SceneDoc) => void,
  options?: MutationOptions,
): void => {
  useDocumentStore.getState().mutate(label, recipe, options);
};

export function addEntity(template: EntityTemplate, parentId: string | null = null): string {
  const { entity } = template;
  mutate(
    `Add ${entity.name}`,
    (scene) => {
      insertEntity(scene, template, parentId);
    },
    // Inside the transaction, so undo takes it back with the entity. Set after
    // `mutate`, it was in no entry at all, and undo left the gizmo pointing at
    // something deleted — B2.
    { select: [entity.id] },
  );
  return entity.id;
}

/**
 * Deletes what the selection names, and what hangs under it.
 *
 * Takes a `Selection` rather than a list of ids so the filter is not re-derived
 * here — `documentOnly()` is the same subset four commands used to compute for
 * themselves, each with its own copy of `splitInstancedId(id) === null`.
 */
export function deleteSelection(selection: Selection): void {
  const all = selection.ids;
  if (all.length === 0) return;

  // An entity a prefab produced is not the scene's to delete: it would come
  // straight back on the next expansion. Refused out loud rather than left to
  // look like a key that did not register.
  const ids = selection.documentOnly();
  if (ids.length < all.length) {
    notify({
      kind: 'warning',
      title: 'Part of a prefab',
      description:
        'Delete the instance, or unpack it first — what a prefab places cannot be removed one piece at a time.',
    });
  }
  if (ids.length === 0) return;

  const kept = useEditorStore.getState().selection;
  mutate(
    ids.length === 1 ? 'Delete entity' : `Delete ${ids.length} entities`,
    (scene) => {
      // Deleting a parent deletes its subtree; leaving orphans behind would
      // strand geometry the user can no longer reach.
      for (const id of ids) removeSubtree(scene, id);
    },
    // Only the ids named here: a descendant that went with them is dropped by
    // the store's own pruning, which knows what the recipe actually removed.
    { select: kept.filter((id) => !ids.includes(id)) },
  );
}

export function renameEntity(id: string, name: string): void {
  const trimmed = name.trim();
  if (trimmed === '') return;
  mutate('Rename entity', (scene) => {
    const entity = scene.entities[id];
    if (entity) entity.name = trimmed;
    else editInstance(scene, id, (override) => void (override.name = trimmed));
  });
}

export function setEntityVisible(id: string, visible: boolean): void {
  mutate(visible ? 'Show entity' : 'Hide entity', (scene) => {
    const entity = scene.entities[id];
    if (entity) entity.visible = visible;
    else editInstance(scene, id, (override) => void (override.visible = visible));
  });
}

/**
 * No caller yet: phase 4 gives it one, in `capabilitiesOf`. Kept rather than
 * deleted and rewritten — the padlock in the hierarchy is meant to reach it.
 */
export function setEntityLocked(id: string, locked: boolean): void {
  mutate(locked ? 'Lock entity' : 'Unlock entity', (scene) => {
    const entity = scene.entities[id];
    if (entity) entity.locked = locked;
  });
}

export function reparentEntity(id: string, parentId: string | null, index?: number): void {
  const scene = useDocumentStore.getState().scene;

  // Said out loud, like `removeEntities` does, because it is a drop the
  // hierarchy panel offers: its rows include what prefabs produced, and those
  // are not the scene's to parent things under. Every other refusal below is a
  // guard against something the interface cannot ask for, and stays silent.
  if (parentId !== null && splitInstancedId(parentId) !== null) {
    notify({
      kind: 'warning',
      title: 'Part of a prefab',
      description:
        'Drop onto the instance itself, or unpack it first — what a prefab places cannot take on children of its own.',
    });
    return;
  }

  // A transform means "relative to my parent", so keeping the numbers across a
  // reparent moves the object: dropped under a parent standing at x=5, it went
  // there too. Every editor keeps the world placement instead — dragging a row
  // in a tree is not a way to move something.
  const transform = localTransformUnder(scene, id, parentId);

  mutate('Reparent entity', (draft) => {
    // Every guard lives in `reparentInScene`, and the move is atomic: a parent
    // the document does not hold — a hierarchy row a prefab produced, which is
    // B1 — leaves the entity exactly where it was rather than in no list at all.
    if (!reparentInScene(draft, id, parentId, index)) return;
    const entity = draft.entities[id];
    if (entity) entity.transform = transform;
  });
}

/**
 * Puts the selection under a new empty parent, without moving any of it.
 *
 * The gesture every editor binds to Ctrl+G — Unreal groups actors, Blender
 * makes a collection — and the reason an "Empty" in the Add menu is not the
 * same thing: making the parent is the easy half, and moving five objects into
 * it one drag at a time is the half nobody wants to do.
 */
export function groupSelection(selection: Selection): string | null {
  const scene = useDocumentStore.getState().scene;

  // `roots()` is the filter that used to live here and nowhere else, though the
  // multi-object gizmo needs the same subset; `documentOnly` keeps what the
  // document actually holds, since a group is an edge and a produced entity has
  // no edge of its own to move.
  const roots = selection
    .roots()
    .filter((id) => splitInstancedId(id) === null && scene.entities[id] !== undefined);
  if (roots.length === 0) return null;

  // The group is born where its contents already are, so its own gizmo lands
  // on them rather than at the world origin.
  const centre = roots
    .map((id) => worldPosition(scene, id))
    .reduce(
      (total, point) => [total[0] + point[0], total[1] + point[1], total[2] + point[2]],
      [0, 0, 0] as [number, number, number],
    )
    .map((value) => value / roots.length) as [number, number, number];

  // Under the parent they share, if they share one — grouping siblings should
  // not lift them out of the branch they were in.
  const parents = new Set(roots.map((id) => scene.entities[id]?.parent ?? null));
  const parentId = parents.size === 1 ? ([...parents][0] ?? null) : null;

  // Built from matrices rather than through `localTransformUnder`, because the
  // group is not in the scene yet: asked for its world placement it would
  // answer with the identity, and everything under it would jump to the origin.
  const groupWorld = translationMatrix(centre);
  const group = createEntity('Group');
  group.entity.transform = transformFromMatrix(
    worldMatrix(scene, parentId).invert().multiply(groupWorld),
  );

  const intoGroup = groupWorld.clone().invert();
  const locals = new Map(
    roots.map((id) => [id, transformFromMatrix(intoGroup.clone().multiply(worldMatrix(scene, id)))]),
  );

  mutate(
    `Group ${roots.length} object${roots.length === 1 ? '' : 's'}`,
    (draft) => {
      if (!insertEntity(draft, group, parentId)) return;

      for (const id of roots) {
        if (!reparentInScene(draft, id, group.entity.id)) continue;
        const entity = draft.entities[id];
        const local = locals.get(id);
        if (entity && local) entity.transform = local;
      }
    },
    { select: [group.entity.id] },
  );

  return group.entity.id;
}

/**
 * Moves everything the selection can move, by one world-space delta.
 *
 * One transaction, and one coalesce key for the whole gesture, so a drag of
 * thirty objects is a single undo step rather than thirty times sixty of them.
 *
 * `transformable()` is the filter phase 4 wrote and tested: it drops locked
 * entities and — the part that is easy to get wrong — the members of the
 * selection that are descendants of another member, which would otherwise be
 * moved twice, once on their own and once under their parent.
 */
export function transformSelection(
  selection: Selection,
  delta: Matrix4,
  options?: { coalesceKey?: string },
): void {
  const targets = selection.transformable();
  if (targets.length === 0) return;

  const scene = useDocumentStore.getState().scene;
  // Computed against the document as it stands *before* the mutation: reading it
  // inside the recipe would compound each target's own move into the next one's.
  const poses = new Map(targets.map((id) => [id, localTransformAfterDelta(scene, id, delta)]));

  mutate(
    targets.length === 1 ? 'Transform' : `Transform ${targets.length} objects`,
    (draft) => {
      for (const [id, pose] of poses) {
        const entity = draft.entities[id];
        if (entity) {
          entity.transform = pose;
          continue;
        }
        // An id the document does not hold names an instance's contents, and the
        // move becomes an override — the same path a single transform takes.
        editInstance(draft, id, (override) => {
          override.transform = { ...override.transform, ...pose };
        });
      }
    },
    options?.coalesceKey === undefined ? undefined : { coalesceKey: options.coalesceKey },
  );
}

/**
 * Reparents everything the selection names, in one transaction.
 *
 * `reparentable()` is `roots()` minus what is locked and what a prefab produced:
 * dragging a node together with its own child would move the child twice, and a
 * locked object should not follow the others. Each target keeps its world
 * placement, as a single reparent does.
 */
export function reparentSelection(
  selection: Selection,
  parentId: string | null,
  index?: number,
): void {
  const scene = useDocumentStore.getState().scene;
  const targets = selection.reparentable();
  if (targets.length === 0) return;

  if (parentId !== null && splitInstancedId(parentId) !== null) {
    notify({
      kind: 'warning',
      title: 'Part of a prefab',
      description:
        'Drop onto the instance itself, or unpack it first — what a prefab places cannot take on children of its own.',
    });
    return;
  }

  // Every target's local transform under the new parent, worked out before
  // anything moves — the same reason as `transformSelection`.
  const locals = new Map(targets.map((id) => [id, localTransformUnder(scene, id, parentId)]));

  mutate(
    targets.length === 1 ? 'Reparent entity' : `Reparent ${targets.length} objects`,
    (draft) => {
      // Reversed when an index is given: each insert pushes the next one along,
      // so going backwards leaves them in the order they were picked.
      const ordered = index === undefined ? targets : [...targets].reverse();
      for (const id of ordered) {
        if (!reparentInScene(draft, id, parentId, index)) continue;
        const entity = draft.entities[id];
        const local = locals.get(id);
        if (entity && local) entity.transform = local;
      }
    },
    { select: targets },
  );
}

export function setTransform(
  id: string,
  patch: Partial<Transform>,
  options?: { coalesceKey?: string },
): void {
  mutate(
    'Transform',
    (scene) => {
      const entity = scene.entities[id];
      if (entity) {
        if (patch.position) entity.transform.position = [...patch.position];
        if (patch.rotation) entity.transform.rotation = [...patch.rotation];
        if (patch.scale) entity.transform.scale = [...patch.scale];
        return;
      }

      // An id the document does not hold names an instance's contents, and the
      // edit becomes an override — which is what lets one placement of a prefab
      // differ from the next. Only what was patched is stored, so a later change
      // to the prefab's rotation still reaches an instance whose position was
      // nudged.
      editInstance(scene, id, (override) => {
        override.transform = { ...override.transform, ...patch };
      });
    },
    options?.coalesceKey === undefined ? undefined : { coalesceKey: options.coalesceKey },
  );
}

/**
 * Components a type cannot work without.
 *
 * A player controller with no collider silently degrades to flying, and a rigid
 * body with no collider passes through the world. Both are easy to hit and hard
 * to diagnose, so the pieces are added together — the same bargain Unity makes
 * when a CharacterController brings its own capsule.
 */
const REQUIRED_COMPANIONS: Partial<Record<ComponentType, readonly ComponentType[]>> = {
  playerController: ['collider', 'rigidbody'],
  rigidbody: ['collider'],
};

/**
 * Components a type cannot sit beside.
 *
 * One entry, and it is the one that sent someone looking for a bug: `mesh` and
 * `model` both draw, both hang from the same container, and both get drawn. So
 * "Add Component ▸ Mesh" on an imported model put a grey 1×1×1 box through it —
 * which reads as the model having been duplicated, not as a second component
 * having been added.
 *
 * Read by the command *and* by the menu that offers it, so the entry cannot be
 * disabled in one place and allowed in the other. The same shape as
 * `REQUIRED_COMPANIONS` above, and symmetric by construction — `excludes()`
 * looks both ways rather than asking anyone to write the pair twice.
 */
const MUTUALLY_EXCLUSIVE: Partial<Record<ComponentType, readonly ComponentType[]>> = {
  mesh: ['model'],
};

/** Whether `type` may be added to an entity that already carries `present`. */
export function componentFits(type: ComponentType, present: ReadonlySet<ComponentType>): boolean {
  for (const other of MUTUALLY_EXCLUSIVE[type] ?? []) {
    if (present.has(other)) return false;
  }
  for (const [declared, excluded] of Object.entries(MUTUALLY_EXCLUSIVE)) {
    if (!present.has(declared as ComponentType)) continue;
    if (excluded?.includes(type)) return false;
  }
  return true;
}

/** Adds a component along with anything it needs, as one undo step. */
export function addComponentWithDependencies(id: string, type: ComponentType): void {
  const scene = useDocumentStore.getState().scene;
  if (!scene.entities[id]) return;

  const siblings = componentsOf(scene, id);
  const present = new Set(siblings.map((component) => component.type));
  // Refused here as well as greyed out in the menu: the menu is one caller, and
  // a shortcut or a script reaching this directly must not be able to build a
  // pairing the editor cannot show.
  if (!componentFits(type, present)) return;

  const toAdd: ComponentType[] = [type];
  for (const companion of REQUIRED_COMPANIONS[type] ?? []) {
    if (!present.has(companion)) toAdd.push(companion);
  }

  mutate(`Add ${type}`, (draft) => {
    if (!draft.entities[id]) return;

    for (const kind of toAdd) {
      const component = createComponentForEntity(kind, siblings);
      // A character is moved by the controller, not by forces, so its body has
      // to be kinematic or physics would fight the input.
      if (component.type === 'rigidbody' && type === 'playerController') {
        component.bodyType = 'kinematicPosition';
      }
      putComponent(draft, id, component);
    }
  });
}

export function removeComponent(id: string, componentId: string): void {
  mutate('Remove component', (scene) => {
    deleteComponent(scene, id, componentId);
  });
}

/**
 * Clears the overrides of an instance being pointed at a different prefab.
 *
 * They name components inside the prefab they were recorded against, so after
 * the swap they name nothing. Dropped and said out loud, rather than kept as
 * entries that quietly never apply again.
 *
 * Lived inside `setComponentField` until phase 3, which has no callers — so the
 * guard was unreachable, and the Inspector, which goes through
 * `setComponentNestedField`, swapped a prefab without it ever running.
 */
function dropOverridesOnPrefabSwap(component: ComponentDoc, path: readonly string[], value: unknown): void {
  if (component.type !== 'prefabInstance') return;
  if (path.length !== 1 || path[0] !== 'assetId') return;
  if (component.assetId === value || Object.keys(component.overrides).length === 0) return;

  notify({
    kind: 'warning',
    title: 'Overrides dropped',
    description: 'They belonged to the prefab this instance pointed at before.',
  });
  component.overrides = {};
}

/**
 * Update one field of one component.
 *
 * `coalesceKey` should be stable for the duration of a drag so a slider scrub
 * lands as a single undo step; pass it as `undefined` on the final commit.
 *
 * **A number that is not finite is refused here**, and this is the boundary the
 * persisted-format rules mean. `NaN` costs nothing to write and everything to
 * find: it survives into the file as `null` — `JSON.stringify(NaN)` says so —
 * and until then every comparison against it answers `false`, so a source with
 * `spatialBlend: NaN` is neither 2D nor 3D and nothing reports a fault.
 *
 * It got in through a live one. Dragging the 2D ↔ 3D slider to zero changes
 * `inspectorSignature`, which rebuilds the pane *during the drag*; Tweakpane's
 * `mousemove` and `mouseup` listeners live on the document until the button
 * comes up, so the disposed slider took one more reading — from an element no
 * longer in the layout, whose width is zero — and `mapRange` divided zero by
 * zero. Any control that loses its footing mid-gesture can do the same, which is
 * why the guard is here rather than next to that one slider.
 */
/** Nested update for material and geometry blocks inside a mesh component. */
export function setComponentNestedField(
  id: string,
  componentId: string,
  path: readonly string[],
  value: unknown,
  options?: { coalesceKey?: string },
): void {
  if (typeof value === 'number' && !Number.isFinite(value)) return;
  mutate(
    'Edit component',
    (scene) => {
      const component = findComponentById(scene, id, componentId);
      if (!component) {
        editInstance(scene, id, (override, current) => {
          overrideComponentPath(override, current, componentId, path, value);
        });
        return;
      }

      dropOverridesOnPrefabSwap(component, path, value);

      let target = component as unknown as Record<string, unknown>;
      for (const key of path.slice(0, -1)) {
        const next = target[key];
        if (typeof next !== 'object' || next === null) return;
        target = next as Record<string, unknown>;
      }
      const last = path.at(-1);
      if (last !== undefined) target[last] = value;
    },
    options?.coalesceKey === undefined ? undefined : { coalesceKey: options.coalesceKey },
  );
}

/**
 * Whether a control handed back something of the shape the document holds.
 *
 * Tweakpane types every binding as `unknown`, and the Inspector schema pairing
 * a field with a control that fits it is a promise the compiler cannot check.
 * Checking it here can be, and this is the same defence the format migration
 * makes at the other boundary: a value of the wrong shape is refused rather
 * than written, where it would reach the binder as something three cannot use.
 *
 * A predicate rather than a cast, so refusing is the compiler's business too —
 * the assignment below does not typecheck without it.
 */
function sameShape<T>(current: T, value: unknown): value is T {
  // The nullable fields are the asset slots, whose control round-trips the
  // empty choice through `''` and back to `null`. So either side being null
  // means the pair is a slot, and the other side must be a slot's two values.
  if (current === null || value === null) {
    return value === null || typeof value === 'string';
  }
  return typeof value === typeof current;
}

export function setEnvironmentField<K extends keyof SceneDoc['environment']>(
  field: K,
  value: unknown,
  options?: { coalesceKey?: string },
): void {
  mutate(
    'Edit environment',
    (scene) => {
      if (sameShape(scene.environment[field], value)) scene.environment[field] = value;
    },
    options?.coalesceKey === undefined ? undefined : { coalesceKey: options.coalesceKey },
  );
}

/**
 * The same, one level down.
 *
 * Its own function rather than a path walk, because a walk would have to write
 * through `Record<string, unknown>` and lose the typing this exists to keep:
 * `field` names a real uniform of the sky, and the compiler says so.
 */
export function setSkyField<K extends keyof SceneDoc['environment']['sky']>(
  field: K,
  value: unknown,
  options?: { coalesceKey?: string },
): void {
  mutate(
    'Edit sky',
    (scene) => {
      if (sameShape(scene.environment.sky[field], value)) scene.environment.sky[field] = value;
    },
    options?.coalesceKey === undefined ? undefined : { coalesceKey: options.coalesceKey },
  );
}

/**
 * The name inside the document, which is not the file it is saved as.
 *
 * The title bar reads the path today, so this only shows up in the Inspector
 * until the scene registry lands and the two are reconciled.
 */
export function setSceneName(name: string): void {
  mutate('Rename scene', (scene) => {
    scene.name = name;
  });
}

export function duplicateSelection(selection: Selection): void {
  // Same reason as `deleteSelection`: a copy of something a prefab produced has
  // nowhere in the document to live.
  const ids = selection.documentOnly();
  if (ids.length === 0) return;
  const created: string[] = [];

  mutate(
    ids.length === 1 ? 'Duplicate entity' : `Duplicate ${ids.length} entities`,
    (scene) => {
      for (const id of ids) {
        const source = scene.entities[id];
        if (!source) continue;
        // The name is worked out here and only for the copy's root: descendants
        // keep theirs, which is what Unity and Blender do. It was computed per
        // cloned node before, which is one of the O(N) costs phase 7 collects.
        const copyId = cloneSubtree(scene, id, source.parent, nextCopyName(scene, source.name));
        if (copyId) created.push(copyId);
      }
    },
    // The function form exists for this: the new ids are only known once the
    // recipe has run, and the selection has to be in the same entry as they are.
    { select: () => (created.length > 0 ? created : useEditorStore.getState().selection) },
  );
}

/** `Cube` -> `Cube (1)` -> `Cube (2)`, matching what Unity and Blender do. */
function nextCopyName(scene: SceneDoc, name: string): string {
  const base = name.replace(/ \(\d+\)$/, '');
  const taken = new Set(Object.values(scene.entities).map((entity) => entity.name));
  for (let index = 1; index < 1000; index++) {
    const candidate = `${base} (${index})`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} (copy)`;
}

export function undo(): void {
  useDocumentStore.getState().undo();
}

export function redo(): void {
  useDocumentStore.getState().redo();
}

/**
 * Edits a shared material asset as one undo step.
 *
 * The write goes to a file rather than to the document, so there are no immer
 * patches to invert — the step carries the before and after values instead and
 * replays them by writing again. Without this, editing a linked material was
 * the one thing in the editor Cmd+Z could not take back.
 */
export function setLinkedMaterialField(
  assetId: string,
  label: string,
  before: MaterialDef,
  after: MaterialDef,
): void {
  const write = (material: MaterialDef) => {
    void useAssetStore.getState().saveMaterial(assetId, material);
  };

  write(after);
  useDocumentStore.getState().recordExternal(`Edit material ${label}`, {
    apply: () => write(after),
    revert: () => write(before),
  });
}
