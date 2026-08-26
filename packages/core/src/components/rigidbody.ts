import { createRigidBody } from '../scene/defaults';
import { defineComponent } from './registry';

/** Physics motion for an entity. */
export const rigidbodyComponent = defineComponent({
  type: 'rigidbody',
  create: () => createRigidBody(),
  fill: (stored) => ({ ...createRigidBody(), ...stored }),
  assets: () => [],
  icon: 'weight',
  runtime: true,
});
