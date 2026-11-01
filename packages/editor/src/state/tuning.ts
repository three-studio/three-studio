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
import { writePath } from '../commands/sceneCommands';
import { useAssetStore } from './assetStore';
import { expandedScene } from './expansion';
import { isSceneLocked } from './sceneLock';

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

/** At the press of Play: the last Play's tuning is dropped. */
export function startTuning(): void {
  useTuningStore.setState((state) => ({ values: [], materials: {}, revision: state.revision + 1 }));
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
  if (!isSceneLocked()) return component;
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
