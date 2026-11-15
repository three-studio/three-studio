import { createEntity, type EntityTemplate } from '../../scene/entity';
import { audioListenerType } from './index';

export function createAudioListenerEntity(): EntityTemplate {
  return createEntity('Audio Listener', [audioListenerType.create()]);
}
