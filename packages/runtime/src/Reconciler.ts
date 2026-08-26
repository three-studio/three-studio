import type { ComponentDoc, ComponentType, EntityDoc } from '@three-studio/core';
import { Group, type Object3D } from 'three/webgpu';
import { CameraSystem } from './systems/CameraSystem';
import type { ComponentSystem, SystemContext, SystemHandle } from './systems/ComponentSystem';
import { ENTITY_ID_KEY } from './systems/identity';
import { LightSystem } from './systems/LightSystem';
import { MeshSystem, type MeshHandle } from './systems/MeshSystem';
import { ModelSystem, type ModelHandle } from './systems/ModelSystem';

/*
 * Mounts, patches and unmounts, one entity at a time.
 *
 * It knows nothing about any component type: it pairs what is mounted against
 * what the document now holds, **by component id**, and hands each pair to the
 * system that claims its type. Adding a renderable type is a system and a line
 * in the table below.
 *
 * The pairing key is the id phase 3 gave every component and phase 10 made the
 * storage key. Before it, builds were keyed by *position* in an array, so
 * removing a component paired a cube's build with a sphere's definition — the
 * geometry key no longer matched, both were rebuilt, and the churn forced the
 * batch holding them to be rebuilt too.
 */

/**
 * A system with its type parameters erased, so one table can hold all four.
 *
 * The cast is at registration and nowhere else. `ComponentSystem<MeshComponent,
 * …>` is genuinely not a `ComponentSystem<ComponentDoc, …>` — a method taking a
 * mesh is not one taking any component — and the guarantee that makes it safe is
 * the table's own key: a system is only ever handed a component of the type it
 * is filed under.
 */
type AnySystem = ComponentSystem<ComponentDoc, SystemHandle>;

const erase = <T extends ComponentDoc, H extends SystemHandle>(
  system: ComponentSystem<T, H>,
): AnySystem => system as unknown as AnySystem;

/** One mounted component: which system owns it, and what it handed back. */
interface Mounted {
  system: AnySystem;
  handle: SystemHandle;
  /** The definition the handle was last built or patched against. */
  doc: ComponentDoc;
}

/** Everything one entity has in the three graph. */
export interface EntityView {
  /** Carries the entity transform; every component object is its child. */
  container: Group;
  /** By component id, so a removal cannot slide the others along. */
  mounted: Map<string, Mounted>;
  /** The document's components as of the last sync, compared element by element. */
  components: readonly ComponentDoc[];
  /** `null` until the first sync, so a new view always applies its transform. */
  transform: EntityDoc['transform'] | null;
}

export class Reconciler {
  private readonly views = new Map<string, EntityView>();

  private readonly meshSystem = new MeshSystem();
  private readonly modelSystem = new ModelSystem();

  /**
   * The four types that draw something. The other seven have no object of their
   * own — physics, audio, scripts and controllers are built by their own layers
   * from the same document, and a prefab instance was turned into real entities
   * by `expandPrefabs` before the runtime ever saw the scene.
   *
   * A `switch` returning `null` for nine of eleven used to stand here. What
   * replaces it is a table that simply does not mention them, which is the same
   * shape the component registry took in phase 9.
   */
  private readonly systems: ReadonlyMap<ComponentType, AnySystem> = new Map([
    ['mesh', erase(this.meshSystem)],
    ['model', erase(this.modelSystem)],
    ['light', erase(new LightSystem())],
    ['camera', erase(new CameraSystem())],
  ]);

  view(entityId: string): EntityView | undefined {
    return this.views.get(entityId);
  }

  all(): ReadonlyMap<string, EntityView> {
    return this.views;
  }

  /**
   * What one component contributed to the graph, by its own id.
   *
   * The per-component sibling of `view()`, and it exists for the editor's
   * overlay: a `CameraHelper` needs *the* camera `CameraSystem` built, and a
   * light helper needs *the* light — which is a different class per `kind`, so
   * the `children.find(instanceof …)` `collectCameras` uses does not generalise.
   * It also misses one of two components of the same type on an entity.
   *
   * Empty rather than absent for anything unmounted, so a caller polling every
   * frame does not have to tell "no such entity" from "nothing built yet".
   */
  objectsOf(entityId: string, componentId: string): readonly Object3D[] {
    return this.views.get(entityId)?.mounted.get(componentId)?.handle.objects ?? [];
  }

  /**
   * The container an entity already has, or nothing.
   *
   * The read-only half of `containerFor`, which **creates**. An editor overlay
   * asking "where is this entity" every frame must not be the thing that brings
   * a view into existence — that would mount a container for an id the document
   * has already dropped, and nothing would ever take it down again.
   */
  peekContainer(entityId: string): Group | undefined {
    return this.views.get(entityId)?.container;
  }

  /** The container an entity's objects hang under, made on first sight. */
  containerFor(entityId: string): Group {
    const existing = this.views.get(entityId);
    if (existing) return existing.container;

    const container = new Group();
    container.userData[ENTITY_ID_KEY] = entityId;
    this.views.set(entityId, {
      container,
      mounted: new Map(),
      components: [],
      transform: null,
    });
    return container;
  }

  /**
   * Brings one entity's objects in line with its components.
   *
   * Every part that the edit did not touch survives: a geometry, a material, a
   * shadow map. Rebuilding wholesale was costing 240ms per inspector drag on a
   * subdivided ground.
   */
  reconcile(entityId: string, components: readonly ComponentDoc[], ctx: SystemContext): void {
    const view = this.views.get(entityId);
    if (!view) return;

    for (const component of components) {
      const system = this.systems.get(component.type);
      if (!system) continue;

      const mounted = view.mounted.get(component.id);
      if (mounted && mounted.system === system) {
        const patched = mounted.system.patch(mounted.handle, mounted.doc, component, ctx);

        if (patched !== 'remount') {
          if (patched !== mounted.handle) {
            this.detach(view, mounted.handle);
            this.attachAll(view, patched);
          }
          view.mounted.set(component.id, { system, handle: patched, doc: component });
          continue;
        }
        // The system cannot write this change onto what it built — a light of a
        // different kind, a camera of a different projection, a different glTF.
        this.drop(view, component.id, ctx);
      } else if (mounted) {
        // Same id, different type. Only a hand-edited file does this, and the
        // alternative is patching a camera with a light's definition.
        this.drop(view, component.id, ctx);
      }

      const handle = system.mount(entityId, component, ctx);
      view.mounted.set(component.id, { system, handle, doc: component });
      this.attachAll(view, handle);
    }

    // Whatever the document no longer holds.
    const live = new Set(components.map((component) => component.id));
    for (const id of [...view.mounted.keys()]) {
      if (!live.has(id)) this.drop(view, id, ctx);
    }

    view.components = components;
  }

  /** Drops everything one entity has, and forgets it. */
  remove(entityId: string, ctx: SystemContext): EntityView | undefined {
    const view = this.views.get(entityId);
    if (!view) return undefined;

    for (const id of [...view.mounted.keys()]) this.drop(view, id, ctx);
    this.views.delete(entityId);
    return view;
  }

  /** Drops every entity. Used by `dispose`. */
  clear(ctx: SystemContext): void {
    for (const entityId of [...this.views.keys()]) this.remove(entityId, ctx);
  }

  /**
   * Takes an object that finished loading after the mount that asked for it.
   *
   * The identity check is on the **handle**, not on the entity: a delete
   * followed by a rebuild under the same id produces a new one, and the old
   * handle's model would otherwise be attached to a container nothing draws.
   * That is B8.
   */
  attachLate(entityId: string, handle: SystemHandle, object: Object3D): boolean {
    const view = this.views.get(entityId);
    if (!view) return false;
    for (const mounted of view.mounted.values()) {
      if (mounted.handle !== handle) continue;
      view.container.add(object);
      return true;
    }
    return false;
  }

  /** Every live mesh build in the scene, which is what the batcher groups. */
  *meshHandles(): Generator<MeshHandle> {
    for (const view of this.views.values()) {
      for (const mounted of view.mounted.values()) {
        if (mounted.doc.type === 'mesh') yield mounted.handle as MeshHandle;
      }
    }
  }

  /** Resolves once every model in flight has landed or failed. */
  whenLoaded(): Promise<void> {
    return this.modelSystem.whenLoaded();
  }

  /**
   * Invalidates every mesh whose material comes from an asset, so each re-reads
   * what the pool now holds.
   *
   * @returns The entity ids this touched, so the caller can sync exactly those.
   */
  entitiesUsingMaterialAssets(): Set<string> {
    const found = new Set<string>();
    for (const [entityId, view] of this.views) {
      for (const mounted of view.mounted.values()) {
        // A model draws with a material asset too, since it can override the
        // one its file shipped with. Asking only about meshes left an edit to a
        // shared material reaching every cube in the scene and none of the
        // imported models using it.
        if (mounted.doc.type !== 'mesh' && mounted.doc.type !== 'model') continue;
        const handle = mounted.handle as MeshHandle | ModelHandle;
        if (handle.materialKey !== null) found.add(entityId);
      }
    }
    return found;
  }

  /** Entity ids carrying a model, for a resolver change that invalidates them all. */
  entitiesWithModels(): Set<string> {
    const found = new Set<string>();
    for (const [entityId, view] of this.views) {
      for (const mounted of view.mounted.values()) {
        if (mounted.doc.type === 'model') found.add(entityId);
      }
    }
    return found;
  }

  private drop(view: EntityView, componentId: string, ctx: SystemContext): void {
    const mounted = view.mounted.get(componentId);
    if (!mounted) return;
    this.detach(view, mounted.handle);
    mounted.system.unmount(mounted.handle, ctx);
    view.mounted.delete(componentId);
  }

  private attachAll(view: EntityView, handle: SystemHandle): void {
    for (const object of handle.objects) view.container.add(object);
  }

  private detach(view: EntityView, handle: SystemHandle): void {
    for (const object of handle.objects) {
      if (object.parent === view.container) object.removeFromParent();
    }
  }
}
