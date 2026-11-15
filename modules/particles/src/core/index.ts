import { defineComponent, type CoreRegistries, type Disposable } from '@three-studio/core';
import { particleEmitterSchema, type ParticleEmitterComponent } from './schema';

/*
 * Particles, the core part: the component type, as data.
 *
 * The first module, and the shape the others follow. Nothing in the kernel
 * names this type: it is added to the document's types from here, registered
 * by `activate`, and a build without this folder reads a scene that holds an
 * emitter as holding a component of a type it does not define — kept as found.
 */

declare module '@three-studio/core' {
  interface ComponentTypes {
    particleEmitter: ParticleEmitterComponent;
  }
}

/**
 * A stream of billboarded particles.
 *
 * Written as a schema: its blank component, its decoder and the sprite it
 * names — so the exporter ships it, the loading bar counts it, and deleting it
 * does not claim nothing uses it — all come from `particleEmitterSchema`, and
 * nothing here repeats a field.
 */
export const particleEmitterType = defineComponent({
  id: 'particleEmitter',
  label: 'Particles',
  version: 1,
  schema: particleEmitterSchema,
  runtime: true,
  addable: true,
});

/** Registers the particle emitter type. Disposing takes it out again. */
export function activate(registries: CoreRegistries): Disposable {
  return registries.components.register(particleEmitterType);
}

export { particleEmitterSchema };
export type { ParticleEmitterComponent };
