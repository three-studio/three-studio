import {
  conformPhysicsMaterial,
  findComponentById,
  linkedPhysicsMaterial,
  type ComponentDoc,
  type PhysicsMaterialDef,
} from '@three-studio/core';
import type { Engine } from '@three-studio/runtime';
import { produce } from 'immer';
import { create } from 'zustand';
import { writeComponentPath, writePath } from '../commands/sceneCommands';
import { useAssetStore } from './assetStore';
import { useDocumentStore } from './documentStore';
import { expandedScene } from './expansion';
import { isSceneLocked } from './sceneLock';
import { toastSlot } from './toastStore';

/*
 * What a Play tunes: the physics rows the Inspector edits while the game runs.
 *
 * Here and in the running world, and never in the document. From the press of
 * Play to Stop nothing writes the scene (`sceneLock.ts`), and a tuned value is
 * no exception, so the lock stays whole; Stop offers the values back, to be
 * written then through the document's ordinary writes.
 */

/** A value tuned during Play, at a path of one component, as the Inspector wrote it. */
export interface Tuned {
  readonly entityId: string;
  readonly componentId: string;
  readonly path: readonly string[];
  readonly value: unknown;
}

interface TuningState {
  /**
   * In the order they were written. A write at a path replaces those at it or
   * under it, and goes last: a kind chosen, then a radius set, kept in place,
   * would write the radius first and lose it under the whole shape.
   */
  readonly values: readonly Tuned[];
  /** Physics material assets tuned during Play, their values as tuned, by asset id. */
  readonly materials: Readonly<Record<string, PhysicsMaterialDef>>;
  /** Moves with every tune, for the Inspector, whose rows read what was tuned. */
  readonly revision: number;
}

export const useTuningStore = create<TuningState>()(() => ({ values: [], materials: {}, revision: 0 }));

/**
 * The engine running the window's scene, which a tune reaches; `null` while the
 * game runs another scene, or none. Module-level, as Play's `running` is: a
 * window has one session.
 */
let engine: Engine | null = null;

/** The offer at Stop: one toast, replaced where it stands. */
const offer = toastSlot();

/**
 * Drops what was tuned, and its offer: at the next press of Play, when the
 * window shows another scene — the values are against the scene Play ran —,
 * and once kept.
 */
export function dropTuning(): void {
  offer.dismiss();
  useTuningStore.setState((state) => ({ values: [], materials: {}, revision: state.revision + 1 }));
}

/**
 * At Stop, when something was tuned: a toast offering to keep it, and Edit ▸
 * Keep Tuned Physics until the next Play or until the window shows another
 * scene. A toast is never the only way to something. Ignored, the values are
 * dropped then.
 */
export function offerTuning(): void {
  if (!hasTuning()) return;
  const { values, materials } = useTuningStore.getState();
  const entities = new Set(values.map(({ entityId }) => entityId)).size;
  const assets = Object.keys(materials).length;
  const on = [
    entities > 0 ? `${entities} ${entities === 1 ? 'entity' : 'entities'}` : null,
    assets > 0 ? `${assets} physics ${assets === 1 ? 'material' : 'materials'}` : null,
  ].filter((part) => part !== null);
  offer.show({
    kind: 'info',
    title: 'Keep the physics tuned during Play?',
    description: `Tuned on ${on.join(' and ')}. Edit ▸ Keep Tuned Physics keeps it until the next Play.`,
    duration: null,
    actions: [{ label: 'Keep', primary: true, onClick: keepTuning }],
  });
}

/** Whether something tuned waits to be kept. */
export function hasTuning(): boolean {
  const { values, materials } = useTuningStore.getState();
  return values.length > 0 || Object.keys(materials).length > 0;
}

/**
 * Writes what the Play tuned into the scene, as one undo step, once the game
 * has stopped, and drops it: each field where the Inspector writes it when
 * stopped, an instance's as its override, over whatever the document holds
 * now; and each tuned physics material to its file. A component gone since is
 * passed by. One Cmd+Z takes all of it back, the files included.
 *
 * A component's fields are written whole, each as tuned: written one value at
 * a time, a radius tuned under a tuned shape went into an instance's override
 * built from the shape the document held before, as the expansion still had it.
 */
export function keepTuning(): void {
  if (isSceneLocked() || !hasTuning()) return;
  const { values, materials } = useTuningStore.getState();
  const { scene } = expandedScene();
  const writes: { entityId: string; componentId: string; key: string; value: unknown }[] = [];
  for (const { entityId, componentId, path } of values) {
    const [key] = path;
    const seen = writes.some(
      (write) => write.entityId === entityId && write.componentId === componentId && write.key === key,
    );
    const component = findComponentById(scene, entityId, componentId);
    if (key === undefined || seen || !component) continue;
    writes.push({ entityId, componentId, key, value: Reflect.get(withTuned(entityId, component), key) });
  }

  const stored = useAssetStore.getState().physicsMaterials;
  const files = Object.entries(materials).flatMap(([assetId, after]) => {
    const before = linkedPhysicsMaterial(assetId, stored);
    return before ? [{ assetId, before, after }] : [];
  });
  const save = (which: 'before' | 'after') => {
    for (const file of files) void useAssetStore.getState().savePhysicsMaterial(file.assetId, file[which]);
  };
  save('after');
  useDocumentStore.getState().mutate(
    'Keep tuned physics',
    (draft) => {
      for (const { entityId, componentId, key, value } of writes) {
        writeComponentPath(draft, entityId, componentId, [key], value);
      }
    },
    files.length === 0 ? undefined : { external: { apply: () => save('after'), revert: () => save('before') } },
  );
  dropTuning();
}

/**
 * The engine running the window's scene from now on, or `null`. It is handed
 * everything tuned so far: a game that restarts the scene, or comes back to it,
 * keeps what this Play tuned.
 */
export function tuningEngine(next: Engine | null): void {
  engine = next;
  if (!next) return;
  const { values, materials } = useTuningStore.getState();
  // The assets first: a collider tuned after them is built with them.
  for (const [assetId, material] of Object.entries(materials)) next.tunePhysicsMaterial(assetId, material);
  const handed = new Set<string>();
  for (const { entityId, componentId } of values) {
    const key = JSON.stringify([entityId, componentId]);
    if (handed.has(key)) continue;
    handed.add(key);
    handTo(next, entityId, componentId);
  }
}

/** Records a component's value as tuned, and hands the running game the component with it. */
export function tuneComponentField(
  entityId: string,
  componentId: string,
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
  if (engine) handTo(engine, entityId, componentId);
}

/**
 * Records one of a physics material's values as tuned, and hands the running
 * game the asset with it: every collider linking it takes it, as every one
 * takes an edit of its file when stopped. The file is not written.
 */
export function tunePhysicsMaterialField(assetId: string, key: string, value: unknown): void {
  const base = tunedPhysicsMaterial(assetId);
  if (!base) return;
  const material = conformPhysicsMaterial({ ...base, [key]: value });
  useTuningStore.setState((state) => ({
    materials: { ...state.materials, [assetId]: material },
    revision: state.revision + 1,
  }));
  engine?.tunePhysicsMaterial(assetId, material);
}

/**
 * The component as the Inspector shows it: during Play, with what was tuned on
 * it; otherwise as it is. So after Stop the Inspector shows the document again,
 * while the values tuned wait to be kept.
 *
 * By entity and component id: an expanded prefab keeps its components' own ids
 * under each instance's entity, so a component id alone repeats.
 */
export function tunedComponent<C extends ComponentDoc>(entityId: string, component: C): C {
  return isSceneLocked() ? withTuned(entityId, component) : component;
}

/** The component with what was tuned on it, the game running or not. */
function withTuned<C extends ComponentDoc>(entityId: string, component: C): C {
  const tuned = useTuningStore
    .getState()
    .values.filter((value) => value.entityId === entityId && value.componentId === component.id);
  if (tuned.length === 0) return component;
  return produce(component, (draft) => {
    for (const { path, value } of tuned) writePath(draft, path, value);
  });
}

/**
 * The same for a physics material asset: its values as tuned during Play, or as
 * the project holds them; `null` for an id the project lacks.
 */
export function tunedPhysicsMaterial(assetId: string): PhysicsMaterialDef | null {
  const tuned = isSceneLocked() ? linkedPhysicsMaterial(assetId, useTuningStore.getState().materials) : null;
  return tuned ?? linkedPhysicsMaterial(assetId, useAssetStore.getState().physicsMaterials);
}

/** Whether `path` is `prefix` or lies under it. */
function within(path: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length <= path.length && prefix.every((key, i) => path[i] === key);
}

/**
 * Hands the running game a component with what was tuned on it, when it is one
 * the world builds: a Rigid Body, a Collider or a Joint.
 */
function handTo(running: Engine, entityId: string, componentId: string): void {
  const component = findComponentById(expandedScene().scene, entityId, componentId);
  if (!component) return;
  const tuned = tunedComponent(entityId, component);
  if (tuned.type === 'rigidbody' || tuned.type === 'collider' || tuned.type === 'joint') {
    running.tune(entityId, tuned);
  }
}
