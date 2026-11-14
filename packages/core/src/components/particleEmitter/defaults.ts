import { createEntity, type EntityTemplate } from '../../scene/entity';
import { particleEmitterComponent } from './index';

/** What "Add ▸ Effects ▸ Particles" places: an entity holding one emitter at its defaults. */
export function createParticleEmitterEntity(): EntityTemplate {
  return createEntity('Particles', [particleEmitterComponent.create()]);
}
