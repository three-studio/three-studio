import {
  findComponentById,
  type AssetId,
  type AssetKind,
  type ComponentDoc,
  type ComponentId,
  type CoreRegistries,
  type EntityId,
} from '@three-studio/core';
import type { World } from '@three-studio/runtime';
import { produce } from 'immer';
import { create } from 'zustand';
import { writeComponentPath, writePath } from '../commands/sceneCommands';
import { assetValues, saveAssetValues } from './assetStore';
import { useDocumentStore } from './documentStore';
import { expandedScene } from './expansion';
import { isSceneLocked } from './sceneLock';
import { toastSlot } from './toastStore';

/*
 * What a Play tunes: the rows the Inspector leaves enabled while the game runs,
 * those of the fields a type marks `tunable`, and the assets the objects among
 * them are filled by.
 *
 * Here and in the running world, and never in the document. From the press of
 * Play to Stop nothing writes the scene (`sceneLock.ts`), and a tuned value is
 * no exception, so the lock stays whole; Stop offers the values back, to be
 * written then through the document's ordinary writes.
 *
 * It names no type and no physics: the running game is handed every tuned
 * component and every tuned asset, and what it built from them takes them
 * (`World.tune`, `World.tuneAsset`).
 */

/** A value tuned during Play, at a path of one component, as the Inspector wrote it. */
export interface Tuned {
  readonly entityId: EntityId;
  readonly componentId: ComponentId;
  readonly path: readonly string[];
  readonly value: unknown;
}

/** An asset's values as tuned during Play, and the kind they are written back to the file as. */
export interface TunedAsset {
  readonly kind: AssetKind;
  readonly values: object;
}

interface TuningState {
  /**
   * In the order they were written. A write at a path replaces those at it or
   * under it, and goes last: a kind chosen, then a radius set, kept in place,
   * would write the radius first and lose it under the whole shape.
   */
  readonly values: readonly Tuned[];
  /** The assets tuned during Play, by asset id. */
  readonly assets: ReadonlyMap<AssetId, TunedAsset>;
  /** Moves with every tune, for the Inspector, whose rows read what was tuned. */
  readonly revision: number;
}

export const useTuningStore = create<TuningState>()(() => ({ values: [], assets: new Map(), revision: 0 }));

/**
 * The world running the window's scene, which a tune reaches; `null` while the
 * game runs another scene, or none. Module-level, as Play's `running` is: a
 * window has one session.
 */
let world: World | null = null;

/** The offer at Stop: one toast, replaced where it stands. */
const offer = toastSlot();

/**
 * Drops what was tuned, and its offer: at the next press of Play, when the
 * window shows another scene — the values are against the scene Play ran —,
 * and once kept.
 */
export function dropTuning(): void {
  offer.dismiss();
  useTuningStore.setState((state) => ({ values: [], assets: new Map(), revision: state.revision + 1 }));
}

/**
 * At Stop, when something was tuned: a toast offering to keep it, and Edit ▸
 * Keep Tuned Values until the next Play or until the window shows another
 * scene. A toast is never the only way to something. Ignored, the values are
 * dropped then.
 */
export function offerTuning(registries: CoreRegistries): void {
  if (!hasTuning()) return;
  const { values, assets } = useTuningStore.getState();
  const entities = new Set(values.map(({ entityId }) => entityId)).size;
  const on = [
    entities > 0 ? `${entities} ${entities === 1 ? 'entity' : 'entities'}` : null,
    assets.size > 0 ? `${assets.size} ${assets.size === 1 ? 'asset' : 'assets'}` : null,
  ].filter((part) => part !== null);
  offer.show({
    kind: 'info',
    title: 'Keep the values tuned during Play?',
    description: `Tuned on ${on.join(' and ')}. Edit ▸ Keep Tuned Values keeps them until the next Play.`,
    duration: null,
    actions: [{ label: 'Keep', primary: true, onClick: () => keepTuning(registries) }],
  });
}

/** Whether something tuned waits to be kept. */
export function hasTuning(): boolean {
  const { values, assets } = useTuningStore.getState();
  return values.length > 0 || assets.size > 0;
}

/**
 * Writes what the Play tuned into the scene, as one undo step, once the game
 * has stopped, and drops it: each field where the Inspector writes it when
 * stopped, an instance's as its override, over whatever the document holds
 * now; and each tuned asset to its file. A component gone since is passed by,
 * and so is an asset. One Cmd+Z takes all of it back, the files included.
 *
 * A component's fields are written whole, each as tuned: written one value at
 * a time, a radius tuned under a tuned shape went into an instance's override
 * built from the shape the document held before, as the expansion still had it.
 */
export function keepTuning(registries: CoreRegistries): void {
  if (isSceneLocked() || !hasTuning()) return;
  const { values, assets } = useTuningStore.getState();
  const { scene } = expandedScene(registries);
  const writes: { entityId: EntityId; componentId: ComponentId; key: string; value: unknown }[] = [];
  for (const { entityId, componentId, path } of values) {
    const [key] = path;
    const seen = writes.some(
      (write) => write.entityId === entityId && write.componentId === componentId && write.key === key,
    );
    const component = findComponentById(scene, entityId, componentId);
    if (key === undefined || seen || !component) continue;
    writes.push({ entityId, componentId, key, value: Reflect.get(withTuned(entityId, component), key) });
  }

  const files = [...assets].flatMap(([assetId, { kind, values: after }]) => {
    const before = assetValues(kind, assetId);
    return before ? [{ kind, assetId, before, after }] : [];
  });
  const save = (which: 'before' | 'after') => {
    for (const file of files) void saveAssetValues(file.kind, file.assetId, file[which]);
  };
  save('after');
  useDocumentStore.getState().mutate(
    'Keep tuned values',
    (draft) => {
      for (const { entityId, componentId, key, value } of writes) {
        writeComponentPath(registries, draft, entityId, componentId, [key], value);
      }
    },
    files.length === 0 ? undefined : { external: { apply: () => save('after'), revert: () => save('before') } },
  );
  dropTuning();
}

/**
 * The world running the window's scene from now on, or `null`. It is handed
 * everything tuned so far: a game that restarts the scene, or comes back to it,
 * keeps what this Play tuned.
 */
export function tuningWorld(registries: CoreRegistries, next: World | null): void {
  world = next;
  if (!next) return;
  const { values, assets } = useTuningStore.getState();
  // The assets first: a component tuned after them is built with them.
  for (const [assetId, tuned] of assets) next.tuneAsset(assetId, tuned.values);
  const handed = new Set<string>();
  for (const { entityId, componentId } of values) {
    const key = JSON.stringify([entityId, componentId]);
    if (handed.has(key)) continue;
    handed.add(key);
    handTo(registries, next, entityId, componentId);
  }
}

/** Records a component's value as tuned, and hands the running game the component with it. */
export function tuneComponentField(
  registries: CoreRegistries,
  entityId: EntityId,
  componentId: ComponentId,
  path: readonly string[],
  value: unknown,
): void {
  useTuningStore.setState((state) => ({
    values: [
      ...state.values.filter(
        (tuned) => tuned.entityId !== entityId || tuned.componentId !== componentId || !within(tuned.path, path),
      ),
      { entityId, componentId, path, value },
    ],
    revision: state.revision + 1,
  }));
  if (world) handTo(registries, world, entityId, componentId);
}

/**
 * Records a value of an asset an object is filled by as tuned, at `path` inside
 * it, and hands the running game the asset with it: whatever it built with the
 * asset takes it — every collider linking a physics material —, as every one
 * takes an edit of its file when stopped. The file is not written.
 */
export function tuneLinkedAsset(kind: AssetKind, assetId: AssetId, path: readonly string[], value: unknown): void {
  const base = tunedAssetValues(kind, assetId);
  if (!base) return;
  const values = structuredClone(base);
  writePath(values, path, value);
  useTuningStore.setState((state) => ({
    assets: new Map(state.assets).set(assetId, { kind, values }),
    revision: state.revision + 1,
  }));
  world?.tuneAsset(assetId, values);
}

/**
 * The component as the Inspector shows it: during Play, with what was tuned on
 * it; otherwise as it is. So after Stop the Inspector shows the document again,
 * while the values tuned wait to be kept.
 *
 * By entity and component id: an expanded prefab keeps its components' own ids
 * under each instance's entity, so a component id alone repeats.
 */
export function tunedComponent<C extends ComponentDoc>(entityId: EntityId, component: C): C {
  return isSceneLocked() ? withTuned(entityId, component) : component;
}

/** The component with what was tuned on it, the game running or not. */
function withTuned<C extends ComponentDoc>(entityId: EntityId, component: C): C {
  const tuned = useTuningStore
    .getState()
    .values.filter((value) => value.entityId === entityId && value.componentId === component.id);
  if (tuned.length === 0) return component;
  return produce(component, (draft) => {
    for (const { path, value } of tuned) writePath(draft, path, value);
  });
}

/**
 * The same for an asset an object is filled by: its values as tuned during
 * Play, or as the project holds them; `null` for an id the project lacks.
 */
export function tunedAssetValues(kind: AssetKind, assetId: AssetId): object | null {
  const tuned = isSceneLocked() ? useTuningStore.getState().assets.get(assetId)?.values : undefined;
  return tuned ?? assetValues(kind, assetId);
}

/** Whether `path` is `prefix` or lies under it. */
function within(path: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length <= path.length && prefix.every((key, i) => path[i] === key);
}

/**
 * Hands the running game a component with what was tuned on it. What it built
 * from the component takes it, and a component it built nothing from changes
 * nothing: which types the world builds is the world's to know.
 */
function handTo(registries: CoreRegistries, running: World, entityId: EntityId, componentId: ComponentId): void {
  const component = findComponentById(expandedScene(registries).scene, entityId, componentId);
  if (component) running.tune(entityId, tunedComponent(entityId, component));
}
