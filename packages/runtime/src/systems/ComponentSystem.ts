import type {
  ComponentDoc,
  ComponentOfType,
  ComponentType,
  Hex,
  MaterialDef,
  Vec3,
} from '@three-studio/core';
import type { BufferGeometry, Material, Mesh, Object3D } from 'three/webgpu';
import type { ModelCache } from '../assets/ModelCache';
import type { StudioTime } from '../time/StudioTime';
import type { ResourceArena } from './ResourceArena';

/*
 * One class per component type that has something to draw.
 *
 * ADR-0013 put these on the *view* side and not in the hierarchy, and the reason is
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

/** A direction to be lit from, and the colour of what is lighting. */
export interface Sun {
  /** Unit vector pointing from the surface at the light. */
  readonly direction: Vec3;
  readonly color: Hex;
}

/** What a system hands back. The only part of it the reconciler reads. */
export interface SystemHandle {
  /** What this component contributes to its entity's container. */
  readonly objects: readonly Object3D[];
}

/**
 * A build that can be drawn in one call alongside others like it.
 *
 * The four fields `MeshBatcher` reads, and nothing else of the mesh it came
 * from. Named here rather than taken as a `MeshHandle` because the batcher's
 * claim is about *batchable builds*, not about meshes: it grouped by
 * `batchKey`, compared materials and uploaded a geometry, and never once
 * needed to know which system had produced them.
 */
export interface BatchableHandle extends SystemHandle {
  readonly mesh: Mesh;
  readonly geometry: BufferGeometry;
  readonly material: Material;
  /**
   * What this build can be drawn alongside. Two builds share a batch when they
   * share this string; the system that made them decides what goes into it.
   */
  readonly batchKey: string;
}

/** What every system may reach, and nothing more. */
export interface SystemContext {
  readonly arena: ResourceArena;
  /** Shared material definitions, by asset id. */
  readonly materials: Readonly<Record<string, MaterialDef>>;
  readonly models: ModelCache;
  /**
   * The one clock. A system that animates reads `time.elapsed` here rather than
   * three's global node, so what it draws obeys Pause and the timescale like
   * everything else — see `time/StudioTime`.
   */
  readonly time: StudioTime;
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
  /**
   * Where a component that shades itself takes its light from.
   *
   * `'sky'` is the scene's analytic sun; anything else is a light entity's id.
   * `null` means "not something this scene can answer" — no such entity, or a
   * source that is not a reference at all — and the caller falls back to
   * whatever it holds itself.
   *
   * Pushed in through the context rather than looked up, for the reason
   * `materials` is: it needs the document *and* the world matrices, and the
   * binder is the only thing holding both. A system is handed a component and
   * could not work it out.
   */
  sunOf(source: string): Sun | null;
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
 * A class rather than a factory, unlike a behaviour: a system owns GPU
 * resources through the arena and has a lifetime tied to the binder that made
 * it, and this repo has one rule for that — a class owns a resource with a
 * lifetime, a free function does not.
 *
 * That is why the registry below registers a **factory of systems** where
 * `registerBehaviour` registers a factory of behaviours. It is the same seam;
 * what comes out of it is built once per reconciler rather than shared.
 */
export abstract class ComponentSystem<T extends ComponentDoc, H extends SystemHandle> {
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

  /*
   * The three capabilities below, and no fourth "in case".
   *
   * Each replaces a walk in `Reconciler` that asked `doc.type === 'mesh'` or
   * `=== 'model'` and then cast the handle it found. The reconciler was the one
   * file written to know about no type in particular, and it knew about two.
   *
   * **Optional, and declaring one is what claims it.** A system that does not
   * implement `whenLoaded` does not load, which is the question
   * `entitiesThatLoad` asks; the two that implement `materialAsset` are the two
   * that can draw with a shared material. Nothing is cast: a system proves its
   * handle is batchable by handing it back as one.
   */

  /** What this build can be drawn in a batch as, when it can be at all. */
  batchable?(handle: H): BatchableHandle;

  /**
   * The asset id of the shared material this build draws with, or `null` for
   * one it owns.
   *
   * A model answers as well as a mesh, since it can override the material its
   * file shipped with. Asking only meshes left an edit to a shared material
   * reaching every cube in the scene and none of the imported models using it.
   */
  materialAsset?(handle: H): string | null;

  /** Resolves once everything this system has in flight has landed or failed. */
  whenLoaded?(): Promise<void>;
}

// --------------------------------------------------------------- the registry

/**
 * A system with its type parameters erased, so one table can hold all five.
 *
 * `ComponentSystem<MeshComponent, …>` is genuinely not a
 * `ComponentSystem<ComponentDoc, …>` — a method taking a mesh is not one taking
 * any component — and the guarantee that makes the erasure safe is the table's
 * own key: a system is only ever handed a component of the type it is filed
 * under. `registerSystem` is where that key and that system meet, so it is the
 * one place the cast is written, and its signature is what ties the two
 * together: a factory building a system written against another type does not
 * compile.
 */
export type AnySystem = ComponentSystem<ComponentDoc, SystemHandle>;

const factories = new Map<ComponentType, () => AnySystem>();

/**
 * Registers the system that draws a component type.
 *
 * The seam `registerBehaviour` already is, for the half of the runtime that
 * draws: a type that has something to show is its own folder under
 * `components/`, and nothing in the reconciler learns that it exists. What
 * replaced a hard-coded table of five is this call made five times, at the
 * imports in `components/index.ts`.
 */
export function registerSystem<T extends ComponentType, H extends SystemHandle>(
  type: T,
  factory: () => ComponentSystem<ComponentOfType<T>, H>,
): void {
  factories.set(type, () => factory() as unknown as AnySystem);
}

/** Whether a type registered a system at all. Read by the check at load. */
export function systemRegistered(type: ComponentType): boolean {
  return factories.has(type);
}

/**
 * One system per registered type, freshly built.
 *
 * Per call and not shared: a system holds what it built, and two reconcilers
 * are two scenes. This is the line that used to be five `new XSystem()` in a
 * field initialiser.
 */
export function buildSystems(): ReadonlyMap<ComponentType, AnySystem> {
  return new Map([...factories].map(([type, factory]) => [type, factory()]));
}
