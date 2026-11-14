import { defineComponent } from '../registry';
import { createCamera } from './defaults';

/** A camera the game can look through. */
export const cameraComponent = defineComponent({
  id: 'camera',
  create: () => createCamera(),
  assets: () => [],
  entities: () => [],
  icon: 'camera',
  placeable: () => true,
  runtime: true,
  addable: true,
});
