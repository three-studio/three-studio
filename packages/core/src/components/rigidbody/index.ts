import { defineComponent } from '../registry';
import { createRigidBody } from './defaults';

/** Physics motion for an entity. */
export const rigidbodyComponent = defineComponent({
  type: 'rigidbody',
  create: () => createRigidBody(),
  fill: (stored) => ({ ...createRigidBody(), ...stored }),
  assets: () => [],
  icon: 'weight',
  runtime: true,
  addable: true,
});
