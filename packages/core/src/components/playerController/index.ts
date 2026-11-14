import type { ComponentDefinition } from '../registry';
import { createPlayerController } from './defaults';
import type { PlayerControllerComponent } from './schema';

/** A first-, third-person or fly controller. */
export const playerControllerComponent: ComponentDefinition<PlayerControllerComponent> = {
  id: 'playerController',
  label: 'Player Controller',
  create: () => createPlayerController(),
  assets: () => [],
  entities: () => [],
  placeable: () => true,
  runtime: true,
  addable: true,
};
