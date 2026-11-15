import type { Disposable } from '@three-studio/core';
import { defineSystem, type RuntimeRegistries } from '@three-studio/runtime';
import { ParticleEmitterSystem } from './ParticleEmitterSystem';

/* Particles, the runtime part: the system that draws an emitter, in the edit view and in a game. */

export const particleEmitterSystem = defineSystem('particleEmitter', () => new ParticleEmitterSystem());

/** Registers the system that draws particle emitters. Disposing takes it out again. */
export function activate(registries: RuntimeRegistries): Disposable {
  return registries.systems.register(particleEmitterSystem);
}

export { ParticleEmitterSystem };
export type { ParticleEmitterHandle } from './ParticleEmitterSystem';
