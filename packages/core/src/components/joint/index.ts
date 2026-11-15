import { bodyOf } from '../../scene/bodies';
import { defineComponent } from '../registry';
import { jointSchema } from './schema';

/** Two bodies held together: see `jointSchema`. */
export const jointType = defineComponent({
  id: 'joint',
  label: 'Joint',
  version: 1,
  schema: jointSchema,
  runtime: true,
  addable: true,
  requires: [
    {
      // A joint holds the body its entity moves with, so on an entity that
      // moves with none it brings a Rigid Body, as Unity's joints require one,
      // and the body brings its Collider; on a child of a body it brings
      // neither. On level geometry meant to stay put, set the new body to
      // Fixed, or put the joint on the side that moves.
      type: 'rigidbody',
      metElsewhere: (scene, entityId) => bodyOf(scene, entityId) !== null,
    },
  ],
});
