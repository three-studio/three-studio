import { componentsOfType, type ComponentType, type SceneDoc } from '@three-studio/core';
import type { SceneBinder } from '@three-studio/runtime';
import { Group, type Object3D } from 'three/webgpu';
import type { ComponentHelper, HelperHandle } from './ComponentHelper';
import { AudioShape } from './helpers/AudioShape';
import { CameraFrustum } from './helpers/CameraFrustum';
import { LightShape } from './helpers/LightShape';

/** One mounted annotation, and what it was built against. */
interface Mounted {
  readonly handle: HelperHandle;
  /**
   * The object the system had built at mount time. A system answering
   * `'remount'` hands back a different one, and comparing identity is how that
   * reaches here — there is no event, and there does not need to be one.
   */
  readonly source: Object3D;
}

/** Entity id and component id, which is what identifies one annotation. */
type Key = string;

const keyOf = (entityId: string, componentId: string): Key => `${entityId}/${componentId}`;

/**
 * Mounts three's helpers on the selection, and takes them down when it changes.
 *
 * Only while selected, which is the whole reason this is not part of the binder:
 * a scene with two hundred lights drawing two hundred cones is unreadable, and
 * the question a helper answers — *what does this one cover* — is only ever
 * asked about the thing being edited.
 *
 * It knows nothing about any component type. It pairs what is mounted against
 * what the selection now holds, by component id, and hands each pair to the
 * helper filed under its type — the same shape as `Reconciler`, one layer up and
 * with far less to own.
 */
export class SelectionHelpers {
  readonly root = new Group();

  /**
   * The table, with its parameters named rather than inferred: left to itself
   * `new Map` takes the shape of its first entry and then refuses the second.
   * No cast is needed to widen the values — `mount` is a method, so TypeScript
   * keeps its parameter bivariant. See `ComponentHelper`.
   */
  private readonly helpers = new Map<ComponentType, ComponentHelper>([
    ['camera', new CameraFrustum()],
    ['light', new LightShape()],
    ['audioSource', new AudioShape()],
  ]);
  private readonly mounted = new Map<Key, Mounted>();

  constructor(private readonly binder: SceneBinder) {
    this.root.name = 'SelectionHelpers';
  }

  /**
   * Call every frame with the current selection.
   *
   * Every lookup is against a component table restricted to the selected ids, so
   * the cost is the size of the selection rather than the size of the scene.
   */
  update(scene: SceneDoc, selection: readonly string[]): void {
    const live = new Set<Key>();

    for (const [type, helper] of this.helpers) {
      const table = componentsOfType(scene, type);
      for (const entityId of selection) {
        const held = table[entityId];
        if (!held) continue;

        for (const [componentId, component] of Object.entries(held)) {
          const key = keyOf(entityId, componentId);
          live.add(key);

          // The first object a component built. A light and a camera each build
          // exactly one; a system that ever builds several would need to say
          // which one is the subject, and none does today.
          // The object the component's system built, or — for a type whose
          // system builds nothing — the entity's own container. An audio source
          // is the case: it holds a voice, not an `Object3D`, and before this
          // fallback its gizmo could never mount. The container's identity is
          // stable for as long as the entity is, so the "rebuild when the source
          // changes" rule below still means what it meant.
          const source =
            this.binder.objectsFor(entityId, componentId)[0] ?? this.binder.containerFor(entityId);
          if (!source) continue;

          const existing = this.mounted.get(key);
          if (existing) {
            if (existing.source === source) {
              existing.handle.update(component);
              continue;
            }
            // The system rebuilt: a different light `kind`, a different camera
            // projection. The annotation points at an object nothing draws.
            this.drop(key, existing);
          }

          const handle = helper.mount(component, source);
          // `null` is a real answer — an ambient light has no shape. Not
          // recorded, so nothing is taken down and nothing is retried per frame
          // beyond one failed `mount`.
          if (!handle) continue;
          for (const object of handle.objects) this.root.add(object);
          this.mounted.set(key, { handle, source });
          handle.update(component);
        }
      }
    }

    for (const [key, entry] of [...this.mounted]) {
      if (!live.has(key)) this.drop(key, entry);
    }
  }

  dispose(): void {
    for (const [key, entry] of [...this.mounted]) this.drop(key, entry);
    this.root.clear();
  }

  private drop(key: Key, entry: Mounted): void {
    for (const object of entry.handle.objects) object.removeFromParent();
    entry.handle.dispose();
    this.mounted.delete(key);
  }
}
