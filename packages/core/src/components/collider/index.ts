import { conform } from '../../conform';
import { conformPhysicsMaterial } from '../../scene/physicsMaterial';
import { defineComponent } from '../registry';
import { conformColliderShape, createCollider } from './defaults';

/**
 * The shape physics uses for an entity.
 *
 * It rides the nearest Rigid Body up the tree, its entity's own included, at its
 * entity's place on that body; with none above it, it is level geometry
 * (`physicsBodies`).
 *
 * Read field by field against its factory, and what it does not know is
 * dropped: physics data is the one place a stored field is not kept for its
 * author. A collider written before scene 11 held a shape's name with every
 * kind's measures beside it, and is not converted: it opens as the factory's
 * 1 m box with the default material, keeping its id and *Is sensor*. Its old
 * `friction` kept beside `material` would read as the collider's to anyone
 * opening the file, and its old `size` as a box's when it was half of one.
 */
export const colliderComponent = defineComponent({
  type: 'collider',
  create: () => createCollider(),
  fill: (stored) => ({
    ...conform(stored, createCollider()),
    shape: conformColliderShape(stored.shape),
    material: conformPhysicsMaterial(stored.material),
  }),
  assets: (component) => [component.materialId],
  icon: 'box',
  placeable: () => true,
  runtime: true,
  addable: true,
});
