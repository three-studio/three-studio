import type { ComponentDefinition } from '../registry';
import { createCamera } from './defaults';
import type { CameraComponent } from './schema';

/** A camera the game can look through. */
export const cameraComponent: ComponentDefinition<CameraComponent> = {
  id: 'camera',
  label: 'Camera',
  create: () => createCamera(),
  assets: () => [],
  entities: () => [],
  icon: 'camera',
  placeable: () => true,
  runtime: true,
  addable: true,
};
