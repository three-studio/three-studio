import { findComponentById, fitColliderShape, type ComponentId, type CoreRegistries, type EntityId } from '@three-studio/core';
import { collectVertices, type SceneBinder } from '@three-studio/runtime';
import { setComponentNestedField } from '../../commands/sceneCommands';
import { expandedScene } from '../../state/expansion';
import { notify } from '../../state/toastStore';

/**
 * Fits a collider around its entity's meshes, keeping its kind, rotation and
 * rounding, as one undo step: Unity's Reset. A collider's size was copied from
 * its mesh once, when it was added, and kept nothing in step afterwards.
 *
 * Read from the expanded scene, so an instance's inner collider fits too, and
 * from the entity's own meshes, as physics builds a mesh collider from them:
 * its children's are theirs. The binder is the edit view's, which holds those
 * meshes as they are drawn, a model loaded through its cache included.
 */
export function fitColliderToMesh(
  registries: CoreRegistries,
  id: EntityId,
  componentId: ComponentId,
  binder: SceneBinder,
): void {
  const { scene } = expandedScene(registries);
  const collider = findComponentById(scene, id, componentId);
  if (collider?.type !== 'collider') return;

  const container = binder.containerFor(id);
  const vertices = container ? collectVertices(container, [1, 1, 1]) : null;
  if (!vertices) {
    const name = scene.entities.get(id)?.name ?? id;
    notify({
      kind: 'warning',
      title: 'Nothing to fit to',
      description: `"${name}" draws no mesh of its own. A Collider fits its own entity's meshes, not its children's.`,
    });
    return;
  }
  setComponentNestedField(registries, id, componentId, ['shape'], fitColliderShape(collider.shape, vertices.positions));
}
