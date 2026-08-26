import { createCollider } from '../scene/defaults';
import { defineComponent } from './registry';

/** The shape physics uses for an entity. */
export const colliderComponent = defineComponent({
  type: 'collider',
  create: () => createCollider(),
  fill: (stored) => ({ ...createCollider(), ...stored }),
  assets: () => [],
  icon: 'box',
  runtime: true,
});
