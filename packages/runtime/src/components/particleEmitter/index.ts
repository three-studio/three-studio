import { defineSystem } from '../../systems/ComponentSystem';
import { ParticleEmitterSystem } from './ParticleEmitterSystem';

export const particleEmitterSystem = defineSystem('particleEmitter', () => new ParticleEmitterSystem());
