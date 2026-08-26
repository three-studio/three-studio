import type { ComponentDoc, ComponentType, MaterialDef } from '@three-studio/core';
import type { Object3D } from 'three/webgpu';
import type { ModelCache } from '../assets/ModelCache';
import type { ResourceArena } from './ResourceArena';

/*
 * One class per component type that has something to draw.
 *
 * ADR-7 put these on the *view* side and not in the hierarchy, and the reason is
 * the one the schema opens with: the document is authoritative and three.js is a
 * derived view. A hierarchy made of objects wrapping `Object3D` cannot be
 * serialised without three, cannot be snapshotted for play mode, and leaves
 * prefab expansion — which produces entities the document does not hold —
 * nowhere to live.
 *
 * What the form buys beyond the split is the **`patch` against `'remount'`
 * contract**. Before it the decision was taken case by case, in three different
 * places, and nobody had noticed they disagreed: materials were patched in
 * place, lights and cameras too since phase 5, and a mesh had its own rules for
 * reusing a geometry. Now each system has to answer the question out loud.
 */

/** What a system hands back. The only part of it the reconciler reads. */
export interface SystemHandle {
  /** What this component contributes to its entity's container. */
  readonly objects: readonly Object3D[];
}

/** What every system may reach, and nothing more. */
export interface SystemContext {
  readonly arena: ResourceArena;
  /** Shared material definitions, by asset id. */
  readonly materials: Readonly<Record<string, MaterialDef>>;
  readonly models: ModelCache;
  /**
   * Per-light shadow map resolution, from the project settings. Square and a
   * power of two; 4096 costs four times the memory of 2048.
   */
  readonly shadowMapSize: number;
  /**
   * Says that what a batch could hold may have changed.
   *
   * A mount or an unmount changes the membership of a group; a `setTransform`
   * does not, which is why regrouping is not simply done every sync — that
   * walked every binding and every mesh build once per frame of a drag to
   * arrive at the same answer.
   */
  invalidate(): void;
  /**
   * Adds an object that only exists now, after the mount that asked for it.
   *
   * glTF loading is asynchronous, so a model arrives one or more frames late —
   * and by then its entity may have been edited, deleted, or rebuilt under the
   * same id. The caller checks that `handle` is still the one mounted there and
   * drops the object otherwise. That is B8, and it is a check the systems cannot
   * make for themselves: only the reconciler knows what is currently mounted.
   *
   * @returns Whether it was taken. `false` means the arrival is stale and the
   *   system should forget it rather than hold an object nothing draws.
   */
  attach(entityId: string, handle: SystemHandle, object: Object3D): boolean;
}

/**
 * Deliberately not a registry keyed by type at module scope, unlike
 * `registerBehaviour`. A system owns GPU resources through the arena and has a
 * lifetime tied to the binder that made it, and this repo has one rule for
 * that: a class owns a resource with a lifetime, a free function does not.
 */
export abstract class ComponentSystem<T extends ComponentDoc, H extends SystemHandle> {
  abstract readonly type: ComponentType;

  /** Builds what this component draws. Called once, on first sight. */
  abstract mount(entityId: string, component: T, ctx: SystemContext): H;

  /**
   * Writes a new definition onto what is already there.
   *
   * `'remount'` when it cannot be done in place — a light of a different `kind`
   * is a different class, a camera of a different projection likewise. Say it
   * rather than rebuilding quietly: the object being kept is what holds a shadow
   * map, and the caller is what frees the one being replaced.
   */
  abstract patch(handle: H, previous: T, next: T, ctx: SystemContext): H | 'remount';

  /** Gives back everything the handle holds. The objects are detached by the caller. */
  abstract unmount(handle: H, ctx: SystemContext): void;
}
