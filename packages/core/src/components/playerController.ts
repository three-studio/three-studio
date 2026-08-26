import { createPlayerController } from '../scene/defaults';
import { defineComponent } from './registry';

/** A first-, third-person or fly controller. */
export const playerControllerComponent = defineComponent({
  type: 'playerController',
  create: () => createPlayerController(),
  fill: (stored) => ({ ...createPlayerController(), ...stored }),
  assets: () => [],
  icon: 'move',
  runtime: true,
});
