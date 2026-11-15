import { collidersOfBody } from '../../scene/bodies';
import { defineComponent } from '../registry';
import { rigidbodySchema } from './schema';

/** A body physics moves: see `rigidbodySchema`. */
export const rigidbodyType = defineComponent({
  id: 'rigidbody',
  label: 'Rigid Body',
  version: 1,
  schema: rigidbodySchema,
  runtime: true,
  addable: true,
  requires: [
    {
      // A body with no collider passes through the world. Its colliders may be
      // on its children, which ride it, and then it brings none of its own.
      type: 'collider',
      metElsewhere: (scene, entityId) => collidersOfBody(scene, entityId).length > 0,
    },
  ],
});
