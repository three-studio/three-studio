import { registerSystem } from '../../systems/ComponentSystem';
import { ParticleEmitterSystem } from './ParticleEmitterSystem';

registerSystem('particleEmitter', () => new ParticleEmitterSystem());
