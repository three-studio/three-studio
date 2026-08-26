import type { GeometryDef, MaterialDef, MeshComponent } from '@three-studio/core';
import { Mesh, type BufferGeometry, type Material, type Texture } from 'three/webgpu';
import { ENTITY_ID_KEY } from './identity';
import { ComponentSystem, type SystemContext, type SystemHandle } from './ComponentSystem';
import { buildGeometry, geometryKeyOf, stableKey } from './geometry';
import { buildMaterial, patchMaterial, sameTextureSlots } from './material';
import { SharedMaterial } from './ResourceArena';

/**
 * What a mesh component built, kept so the next patch can reuse it.
 *
 * The defs are held by reference on purpose: immer preserves the identity of
 * anything a mutation did not touch, so `previous.geometryDef === next` is an
 * exact "nothing here changed" — no deep comparison needed.
 */
export interface MeshHandle extends SystemHandle {
  mesh: Mesh;
  geometryDef: GeometryDef;
  /** Identifies the pooled geometry this handle holds a reference to. */
  geometryKey: string;
  geometry: BufferGeometry;
  materialDef: MaterialDef;
  /** The asset id when the material is shared; `null` when this handle owns it. */
  materialKey: string | null;
  material: Material;
  textures: Texture[];
  /**
   * What this mesh can be drawn alongside. Computed here rather than per sync:
   * it involves serialising the material definition, and doing that for three
   * thousand meshes on every keystroke costs more than the batch saves.
   */
  batchKey: string;
  readonly objects: readonly Mesh[];
}

/**
 * The mesh: geometry from the pool, material shared or private, and the one
 * `Mesh` object that outlives every edit that does not change either.
 *
 * The largest of the four systems, and the only one whose `patch` has three
 * outcomes rather than two — full reuse, a material patched in place, or a
 * rebuild. That distinction is worth 240ms per inspector drag on a subdivided
 * ground: dragging the tiling pad used to throw away and rebuild a 550k-triangle
 * geometry, a node material and its textures, sixty times a second.
 */
export class MeshSystem extends ComponentSystem<MeshComponent, MeshHandle> {
  readonly type = 'mesh' as const;

  mount(entityId: string, component: MeshComponent, ctx: SystemContext): MeshHandle {
    const handle = this.build(component, undefined, ctx);
    handle.mesh.userData[ENTITY_ID_KEY] = entityId;
    ctx.invalidate();
    return handle;
  }

  /**
   * Never `'remount'`.
   *
   * Every part of a mesh can be replaced independently of the others — that is
   * what `build` does — so tearing the whole thing down would always throw away
   * more than the edit touched. The `Mesh` object itself survives too, which
   * keeps whatever is pointing at it (the outline, the gizmo, a batch slot)
   * pointing at the same thing.
   */
  patch(
    handle: MeshHandle,
    _previous: MeshComponent,
    next: MeshComponent,
    ctx: SystemContext,
  ): MeshHandle {
    const entityId: unknown = handle.mesh.userData[ENTITY_ID_KEY];
    const rebuilt = this.build(next, handle, ctx);
    if (typeof entityId === 'string') rebuilt.mesh.userData[ENTITY_ID_KEY] = entityId;
    // Geometry or material may have changed, and both are in the batch key.
    ctx.invalidate();
    return rebuilt;
  }

  unmount(handle: MeshHandle, ctx: SystemContext): void {
    ctx.arena.releaseGeometry(handle.geometryKey);
    if (handle.materialKey !== null) ctx.arena.releaseMaterial(handle.materialKey);
    // A private material and its textures belong to this handle alone.
    else ctx.arena.retire(new SharedMaterial({ material: handle.material, textures: handle.textures }));
    ctx.invalidate();
  }

  /** The definition a mesh renders with: the shared asset if it has one. */
  private definitionFor(component: MeshComponent, ctx: SystemContext): MaterialDef {
    if (component.materialId === null) return component.material;
    return ctx.materials[component.materialId] ?? component.material;
  }

  private build(
    component: MeshComponent,
    previous: MeshHandle | undefined,
    ctx: SystemContext,
  ): MeshHandle {
    const materialDef = this.definitionFor(component, ctx);

    // Exactly one reference per live handle, so the count stays balanced whether
    // this is a first build, a reuse or a change.
    const geometryKey = geometryKeyOf(component.geometry);
    let geometry: BufferGeometry;
    if (previous && previous.geometryKey === geometryKey) {
      geometry = previous.geometry;
    } else {
      geometry = ctx.arena.geometry(geometryKey, () => buildGeometry(component.geometry));
      if (previous) ctx.arena.releaseGeometry(previous.geometryKey);
    }

    const { material, textures, materialKey } = this.materialFor(
      component,
      materialDef,
      previous,
      ctx,
    );

    // The `Mesh` itself is cheap but reusing it keeps whatever holds a
    // reference to it — the outline, the gizmo — pointing at the same object.
    const mesh = previous?.mesh ?? new Mesh();
    mesh.geometry = geometry;
    mesh.material = material;
    mesh.castShadow = component.castShadow;
    mesh.receiveShadow = component.receiveShadow;

    return {
      mesh,
      geometryDef: component.geometry,
      geometryKey,
      geometry,
      materialDef,
      materialKey,
      material,
      textures,
      batchKey: `${geometryKey}|${materialKey ?? stableKey(materialDef)}|${
        component.castShadow ? 1 : 0
      }|${component.receiveShadow ? 1 : 0}`,
      objects: [mesh],
    };
  }

  /**
   * A material asset is one material, however many meshes name it.
   *
   * Only the linked case is pooled. An embedded material belongs to its mesh
   * alone, and keeping it private is what lets a slider drag patch uniforms in
   * place — sharing it would mean rebuilding a node material, and a new node
   * material is a new shader pipeline.
   */
  private materialFor(
    component: MeshComponent,
    materialDef: MaterialDef,
    previous: MeshHandle | undefined,
    ctx: SystemContext,
  ): { material: Material; textures: Texture[]; materialKey: string | null } {
    const key = component.materialId;

    /**
     * A private material belongs to the handle that built it, so a handle that
     * stops using one has to hand it over. The pooled case is a `release`; this
     * one has no pool to release into, and forgetting it leaks a node material
     * and its textures every time a mesh is linked to an asset.
     */
    const retirePrivate = (): void => {
      if (!previous || previous.materialKey !== null) return;
      ctx.arena.retire(
        new SharedMaterial({ material: previous.material, textures: previous.textures }),
      );
    };

    if (key !== null) {
      if (previous?.materialKey !== key) {
        if (previous?.materialKey != null) ctx.arena.releaseMaterial(previous.materialKey);
        else retirePrivate();
        const shared = ctx.arena.material(
          key,
          () => new SharedMaterial(buildMaterial(materialDef, ctx.models)),
        );
        return { material: shared.material, textures: shared.textures, materialKey: key };
      }

      const shared = ctx.arena.peekMaterial(key);
      if (!shared) {
        const rebuilt = ctx.arena.material(
          key,
          () => new SharedMaterial(buildMaterial(materialDef, ctx.models)),
        );
        return { material: rebuilt.material, textures: rebuilt.textures, materialKey: key };
      }

      // Read-only on this path. Whether the asset changed, and what to do about
      // it, was decided once by the library pass — deciding it again here, per
      // mesh, against a stale `previous`, is B5.
      return { material: shared.material, textures: shared.textures, materialKey: key };
    }

    // Private from here on. A handle that was sharing gives its reference back.
    if (previous?.materialKey != null) ctx.arena.releaseMaterial(previous.materialKey);

    if (previous && previous.materialKey === null && previous.materialDef === materialDef) {
      return { material: previous.material, textures: previous.textures, materialKey: null };
    }
    if (
      previous &&
      previous.materialKey === null &&
      sameTextureSlots(previous.materialDef, materialDef)
    ) {
      patchMaterial(previous.material, previous.textures, materialDef);
      return { material: previous.material, textures: previous.textures, materialKey: null };
    }

    // A slot changed, so the shader changes: a new material, and the old one
    // goes back through the queue rather than being disposed here.
    retirePrivate();
    const rebuilt = buildMaterial(materialDef, ctx.models);
    return { material: rebuilt.material, textures: rebuilt.textures, materialKey: null };
  }
}
