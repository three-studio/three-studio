import { defineComponent } from '../registry';
import { createPlayerController } from './defaults';

/** A first-, third-person or fly controller. */
export const playerControllerComponent = defineComponent({
  type: 'playerController',
  create: () => createPlayerController(),
  assets: () => [],
  icon: 'move',
  placeable: () => true,
  runtime: true,
  addable: true,
});
