import type { ComponentDefinition } from '../registry';
import { createAudioListener } from './defaults';
import type { AudioListenerComponent } from './schema';

/**
 * The ear the mix is rendered for.
 *
 * `runtime: true` since the runtime plays sound. A scene with none is not
 * silent: the engine falls back to the camera the game is rendered through,
 * which is where the ear belongs far more often than not. A scene with several
 * gets a warning, because two ears is a bug that sounds like a mixing problem.
 */
export const audioListenerComponent: ComponentDefinition<AudioListenerComponent> = {
  id: 'audioListener',
  label: 'Audio Listener',
  create: createAudioListener,
  assets: () => [],
  entities: () => [],
  placeable: () => true,
  runtime: true,
  addable: true,
};
