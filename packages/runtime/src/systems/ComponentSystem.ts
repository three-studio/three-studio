import type {
  AssetId,
  ComponentDoc,
  ComponentOfType,
  ComponentType,
  EntityId,
  Hex,
  MaterialDef,
  Vec3,
} from '@three-studio/core';
import type { BufferGeometry, Material, Mesh, Object3D } from 'three/webgpu';
import type { AssetCache } from '../assets/AssetCache';
import type { StudioTime } from '../time/StudioTime';
import type { CameraClaims } from '../world/cameras';
import type { ResourceArena } from './ResourceArena';

/*
 * One class per component type that has something to draw.
 *
 * These are on the *view* side and not in the hierarchy, and the reason is
 * the one the schema opens with: the document is authoritative and three.js is a
 * derived view. A hierarchy made of objects wrapping `Object3D` cannot be
 * serialised without three, cannot be snapshotted for play mode, and leaves
 * prefab expansion — which produces entities the document does not hold —
 * nowhere to live.
 *
 * What the form buys beyond the split is the **`patch` against `'remount'`
 * contract**. Before it the decision was taken case by case, in three different
 * places, and nobody had noticed they disagreed: materials were patched in
 * place, lights and cameras too, and a mesh had its own rules for reusing a
 * geometry. Now each system has to answer the question out loud.
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
  readonly materials: ReadonlyMap<AssetId, MaterialDef>;
  /**
   * The project's loaded files. A system holds what it draws — a model, an
   * image — and gives it back when it stops; the cache alone frees.
   */
  readonly assets: AssetCache;
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
   * Who the view is drawn through, which a camera claims as it mounts and gives
   * back as it goes: the world's, so the world never asks the scene which
   * camera it holds.
   */
  readonly cameras: CameraClaims;
  /**
   * Says that what a batch could hold may have changed.
   *
   * A mount or an unmount changes the membership of a group; a `setTransform`
   * does not, which is why regrouping is not simply done every sync — that
   * walked every binding and every mesh build once per frame of a drag to
   * arrive at the same answer.
   */
  /**
   * Where a component that shades itself takes its light from: a light
   * entity's, or `null` for the scene's analytic sun. Answers `null` when the
   * scene cannot say — no such light — and the caller falls back.
   *
   * Pushed in through the context rather than looked up, for the reason
   * `materials` is: it needs the document *and* the world matrices, and the
   * binder is the only thing holding both. A system is handed a component and
   * could not work it out.
   */
  sunOf(light: EntityId | null): Sun | null;
  invalidate(): void;
  /**
   * Adds an object that only exists now, after the mount that asked for it.
   *
   * glTF loading is asynchronous, so a model arrives one or more frames late —
   * and by then its entity may have been edited, deleted, or rebuilt under the
   * same id. The caller checks that `handle` is still the one mounted there and
   * drops the object otherwise. It is a check the systems cannot
   * make for themselves: only the reconciler knows what is currently mounted.
   *
   * @returns Whether it was taken. `false` means the arrival is stale and the
   *   system should forget it rather than hold an object nothing draws.
   */
  attach(entityId: EntityId, handle: SystemHandle, object: Object3D): boolean;
}

/**
 * A class rather than a factory, unlike a behaviour: a system owns GPU
 * resources through the arena and has a lifetime tied to the binder that made
 * it, and this repo has one rule for that — a class owns a resource with a
 * lifetime, a free function does not.
 *
 * That is why its definition below holds a **factory of systems** where a
 * behaviour's definition holds a factory of behaviours. It is the same seam;
 * what comes out of it is built once per reconciler rather than shared.
 */
export abstract class ComponentSystem<T extends ComponentDoc, H extends SystemHandle> {
  /** Builds what this component draws. Called once, on first sight. */
  abstract mount(entityId: EntityId, component: T, ctx: SystemContext): H;

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
   * The four capabilities below, and no fifth "in case".
   *
   * Each replaces a place that named a type. Three were walks in `Reconciler`
   * that asked `doc.type === 'mesh'` or `=== 'model'` and then cast the handle
   * they found — the reconciler was the one file written to know about no type
   * in particular, and it knew about two —, and `diagnose` the world's own
   * checks, which asked the document for its cameras and its lights.
   *
   * **Optional, and declaring one is what claims it.** A system that does not
   * implement `whenLoaded` does not load, which is what the reconciler waits
   * on; the two that implement `materialAsset` are the two that can draw with
   * a shared material. Nothing is cast: a system proves its
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
  materialAsset?(handle: H): AssetId | null;

  /** Resolves once everything this system has in flight has landed or failed. */
  whenLoaded?(): Promise<void>;

  /**
   * What is wrong with the scene this system drew, said once when a world in
   * Play has been built: the camera system's two main cameras, the light
   * system's scene with no light. Never asked of the edit view.
   */
  diagnose?(): readonly string[];
}

// ------------------------------------------------------------- the definition

/**
 * A system with its type parameters erased, so one registry can hold all six.
 *
 * `ComponentSystem<MeshComponent, …>` is not, strictly, a
 * `ComponentSystem<ComponentDoc, …>` — a method taking a mesh is not one taking
 * any component. TypeScript compares a method's parameters both ways, so it
 * passes for one without a cast, and the guarantee that makes that sound is the
 * registry's own key: a system is only ever handed a component of the type it
 * is filed under. `defineSystem` is where that key and that system meet, and
 * its signature is what ties the two together: a factory building a system
 * written against another type does not compile.
 *
 * The members above are methods for that reason. Written as arrow-typed
 * properties they would be compared one way only, and every definition would
 * stop compiling, loudly.
 */
export type AnySystem = ComponentSystem<ComponentDoc, SystemHandle>;

/** The system that draws a component type: what the runtime's activation registers. */
export interface SystemDefinition {
  readonly id: ComponentType;
  /**
   * A new system, per reconciler and not shared: a system holds what it built,
   * and two reconcilers are two scenes.
   */
  create(): AnySystem;
}

/**
 * The definition of the system that draws `id`.
 *
 * A type that has something to show is its own folder under `components/`,
 * whose `index.ts` exports this, and nothing in the reconciler learns that it
 * exists: the runtime's activation registers it, and each reconciler builds one
 * from the registry.
 */
export function defineSystem<T extends ComponentType, H extends SystemHandle>(
  id: T,
  create: () => ComponentSystem<ComponentOfType<T>, H>,
): SystemDefinition {
  return { id, create };
}
