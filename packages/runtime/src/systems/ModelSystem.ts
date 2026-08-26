import type { ModelComponent } from '@three-studio/core';
import { Mesh, type Material, type Object3D } from 'three/webgpu';
import { ComponentSystem, type SystemContext, type SystemHandle } from './ComponentSystem';
import { ENTITY_ID_KEY } from './identity';
import { buildMaterial } from './material';
import { SharedMaterial } from './ResourceArena';

export interface ModelHandle extends SystemHandle {
  assetId: string;
  /** Which node of the file; `''` is the whole thing. See `ModelComponent`. */
  nodePath: string;
  nodeName: string;
  castShadow: boolean;
  receiveShadow: boolean;
  /**
   * The material asset every mesh below is drawing, or `null` for the file's own.
   *
   * A key, not the object: it is what `unmount` gives back to the pool, and
   * holding the object instead would leave the count one short for every model
   * that ever named a material.
   */
  materialKey: string | null;
  /**
   * What each mesh drew before an override was written onto it.
   *
   * Filled on the first override and read when one is taken away. Without it,
   * clearing the material field leaves the last one assigned: the file's own
   * belongs to `ModelCache` and is still perfectly alive, but this clone no
   * longer has a reference to it anywhere.
   *
   * Lazily, so a model nobody re-materialled — which is nearly all of them —
   * carries an empty map and nothing else.
   */
  readonly sourceMaterials: Map<Mesh, Material | Material[]>;
  /** Grows when the load lands. Empty until then, and empty forever if it fails. */
  readonly objects: Object3D[];
}

/**
 * An imported glTF, which is the only thing here that does not exist yet when
 * it is mounted.
 *
 * The load is in flight for one or more frames, and everything that can go
 * wrong in that window has gone wrong at least once: the entity is deleted, the
 * component is edited, or the entity is rebuilt under the same id. The handle
 * itself is the identity that answers all three — the reconciler drops an
 * arrival whose handle is no longer the mounted one, which is B8.
 *
 * It draws **one node or the whole file**, which is what an unpacked model is
 * made of: `unpackModel` turns an import into one entity per node, each naming
 * its own `nodePath`, and each of them then transformable, selectable and given
 * a material of its own. That is the arrangement Unity's imported prefab has —
 * a leaf pointing at a sub-asset of the model file — and the reason it is here
 * rather than on `mesh` is that `GeometryDef` is thirteen primitives with no way
 * to name a file, while this system already loads asynchronously and already
 * owns nothing.
 */
export class ModelSystem extends ComponentSystem<ModelComponent, ModelHandle> {
  /** In-flight loads, so `whenLoaded()` can wait for a settled scene. */
  private readonly pending = new Set<Promise<void>>();

  readonly type = 'model' as const;

  mount(entityId: string, component: ModelComponent, ctx: SystemContext): ModelHandle {
    const handle: ModelHandle = {
      assetId: component.assetId,
      nodePath: component.nodePath,
      nodeName: component.nodeName,
      castShadow: component.castShadow,
      receiveShadow: component.receiveShadow,
      materialKey: null,
      sourceMaterials: new Map(),
      objects: [],
    };
    // Before the load, so the material is in hand when the object arrives: the
    // arrival is a callback, and reaching for the pool from there would take a
    // reference the reconciler may already have dropped the handle for.
    this.claimMaterial(handle, component, ctx);
    this.load(entityId, handle, ctx);
    return handle;
  }

  /**
   * Shadow flags and the material are written onto what has already arrived; a
   * different asset or a different node is a different object.
   *
   * Remounting for a shadow flag — or for a material — would restart a glTF
   * load, a network fetch and a parse, because a checkbox moved. The material is
   * the stronger case of the two: it is the field an author drags a swatch onto,
   * and a reload per drop is the difference between choosing a material and
   * waiting for one.
   */
  patch(
    handle: ModelHandle,
    _previous: ModelComponent,
    next: ModelComponent,
    ctx: SystemContext,
  ): ModelHandle | 'remount' {
    if (handle.assetId !== next.assetId) return 'remount';
    if (handle.nodePath !== next.nodePath) return 'remount';

    handle.castShadow = next.castShadow;
    handle.receiveShadow = next.receiveShadow;
    // The name is only a fallback for a path that has stopped resolving, so a
    // change to it alone is not worth a reload of the file.
    handle.nodeName = next.nodeName;

    if (handle.materialKey !== next.materialId) {
      if (handle.materialKey !== null) ctx.arena.releaseMaterial(handle.materialKey);
      this.claimMaterial(handle, next, ctx);
    }

    this.dress(handle, ctx);
    return handle;
  }

  /**
   * Frees nothing it did not take.
   *
   * A loaded glTF's geometries and materials belong to `ModelCache`, which hands
   * out clones sharing them and owns their lifetime. Disposing them here would
   * free buffers every other instance of the same model is still drawing.
   *
   * The pooled material is the exception, and the only thing this handle ever
   * took a reference to.
   */
  unmount(handle: ModelHandle, ctx: SystemContext): void {
    if (handle.materialKey !== null) ctx.arena.releaseMaterial(handle.materialKey);
    handle.materialKey = null;
    handle.sourceMaterials.clear();
    handle.objects.length = 0;
  }

  /** Resolves once every model in flight has landed or failed. */
  async whenLoaded(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }

  /**
   * Takes a reference on the shared material this model draws with, if any.
   *
   * Read-only against the pool once it is there, exactly as `MeshSystem` is on
   * the same path: whether the asset's definition changed, and what to do about
   * it, is decided once by the library pass in `SceneBinder.setMaterialLibrary`.
   * Deciding it again per model, against a stale copy, is B5.
   */
  private claimMaterial(
    handle: ModelHandle,
    component: ModelComponent,
    ctx: SystemContext,
  ): void {
    handle.materialKey = component.materialId;
    if (component.materialId === null) return;

    const definition = ctx.materials[component.materialId];
    if (definition === undefined) {
      // An id naming a material the project no longer holds. Left on the file's
      // own material rather than blanked, and the key given back so the count
      // stays balanced.
      handle.materialKey = null;
      return;
    }
    ctx.arena.material(
      component.materialId,
      () => new SharedMaterial(buildMaterial(definition, ctx.models)),
    );
  }

  /** The material a handle should be drawing, or `null` for the file's own. */
  private materialFor(handle: ModelHandle, ctx: SystemContext): Material | null {
    if (handle.materialKey === null) return null;
    return ctx.arena.peekMaterial(handle.materialKey)?.material ?? null;
  }

  /**
   * Writes the shadow flags and the material onto whatever has arrived.
   *
   * One walk for both, and it runs on the arrival as well as on a patch: a model
   * lands one or more frames after the mount that asked for it, so the settings
   * it was mounted with have to be applied twice or not at all.
   */
  private dress(handle: ModelHandle, ctx: SystemContext): void {
    const material = this.materialFor(handle, ctx);
    for (const object of handle.objects) {
      object.traverse((child) => {
        if (!(child instanceof Mesh)) return;
        child.castShadow = handle.castShadow;
        child.receiveShadow = handle.receiveShadow;

        if (material !== null) {
          // Remembered before it is overwritten, and only the first time: a
          // second override must not record the first one as the original.
          if (!handle.sourceMaterials.has(child)) {
            handle.sourceMaterials.set(child, child.material);
          }
          // Assigned, never disposed. The mesh's own material belongs to
          // `ModelCache`, and every other clone of this file is still drawing
          // it.
          child.material = material;
          return;
        }

        const source = handle.sourceMaterials.get(child);
        if (source !== undefined) {
          child.material = source;
          handle.sourceMaterials.delete(child);
        }
      });
    }
  }

  private load(entityId: string, handle: ModelHandle, ctx: SystemContext): void {
    if (handle.assetId === '') return;

    const pending = this.fetch(handle, ctx)
      .then((object) => {
        if (object === null) {
          console.warn(
            `[scene] ${handle.assetId} has no node "${handle.nodePath}"${
              handle.nodeName === '' ? '' : ` (${handle.nodeName})`
            }; nothing drawn.`,
          );
          return;
        }

        object.userData[ENTITY_ID_KEY] = entityId;
        object.traverse((child) => {
          child.userData[ENTITY_ID_KEY] = entityId;
        });

        // Refused by the reconciler when this handle is no longer the one
        // mounted there. Kept only once it is accepted, or the handle would
        // hold an object nothing ever drew and `unmount` would have to know it.
        if (!ctx.attach(entityId, handle, object)) return;
        handle.objects.push(object);
        this.dress(handle, ctx);
      })
      .catch((error: unknown) => {
        console.error(`[scene] failed to load model ${handle.assetId}:`, error);
      })
      .finally(() => {
        this.pending.delete(pending);
      });

    this.pending.add(pending);
  }

  /** The whole file, or the single node this handle names. */
  private fetch(handle: ModelHandle, ctx: SystemContext): Promise<Object3D | null> {
    if (handle.nodePath === '') return ctx.models.loadModel(handle.assetId);
    return ctx.models.loadNode(handle.assetId, handle.nodePath, handle.nodeName);
  }
}
