import { conform, oneOf } from '../../conform';
import { defineComponent } from '../registry';
import { createRigidBody } from './defaults';
import { BODY_TYPE_LABELS } from './schema';

/**
 * Physics motion for an entity.
 *
 * Read field by field against its factory, as the collider is, and what it does
 * not know is dropped. Its type decides how every collider riding it is built,
 * and Play threw on one this build does not know: that reads as Dynamic. Its
 * mass is shared out among its colliders by volume, and one not above zero sank
 * the body through the floor: that reads as the factory's.
 */
export const rigidbodyComponent = defineComponent({
  type: 'rigidbody',
  create: () => createRigidBody(),
  fill: (stored) => {
    const model = createRigidBody();
    const body = conform(stored, model);
    return {
      ...body,
      bodyType: oneOf(stored.bodyType, BODY_TYPE_LABELS, model.bodyType),
      mass: body.mass > 0 ? body.mass : model.mass,
    };
  },
  assets: () => [],
  icon: 'weight',
  placeable: () => true,
  runtime: true,
  addable: true,
});
