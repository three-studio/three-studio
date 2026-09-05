import { defineComponent } from '../registry';
import { createCollider } from './defaults';

/** The shape physics uses for an entity. */
export const colliderComponent = defineComponent({
  type: 'collider',
  create: () => createCollider(),
  fill: (stored) => ({ ...createCollider(), ...stored }),
  assets: () => [],
  icon: 'box',
  runtime: true,
  addable: true,
});
