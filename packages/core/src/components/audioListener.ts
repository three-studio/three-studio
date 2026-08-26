import { blankComponent as blank } from '../scene/defaults';
import { defineComponent } from './registry';

/**
 * The ear the mix is rendered for.
 *
 * `runtime: true` since the audio chantier. A scene with none is not silent:
 * the engine falls back to the camera the game is rendered through, which is
 * where the ear belongs far more often than not. A scene with several gets a
 * warning, because two ears is a bug that sounds like a mixing problem.
 */
export const audioListenerComponent = defineComponent({
  type: 'audioListener',
  create: () => blank('audioListener'),
  fill: (stored) => ({ ...blank('audioListener'), ...stored }),
  assets: () => [],
  icon: 'volume',
  runtime: true,
});
