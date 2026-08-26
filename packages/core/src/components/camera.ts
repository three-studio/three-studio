import { createCamera } from '../scene/defaults';
import { defineComponent } from './registry';

/** A camera the game can look through. */
export const cameraComponent = defineComponent({
  type: 'camera',
  create: () => createCamera(),
  fill: (stored) => ({ ...createCamera(), ...stored }),
  assets: () => [],
  icon: 'camera',
  runtime: true,
});
