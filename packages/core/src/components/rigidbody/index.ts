import { defineComponent } from '../registry';
import { createRigidBody } from './defaults';

/** Physics motion for an entity. */
export const rigidbodyComponent = defineComponent({
  type: 'rigidbody',
  create: () => createRigidBody(),
  assets: () => [],
  icon: 'weight',
  placeable: () => true,
  runtime: true,
  addable: true,
});
