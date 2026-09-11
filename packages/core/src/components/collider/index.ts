import { defineComponent } from '../registry';
import { createCollider } from './defaults';

/** The shape physics uses for an entity. */
export const colliderComponent = defineComponent({
  type: 'collider',
  create: () => createCollider(),
  assets: () => [],
  icon: 'box',
  placeable: () => true,
  runtime: true,
  addable: true,
});
