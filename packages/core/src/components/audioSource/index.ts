import type { ComponentDefinition } from '../registry';
import { createAudioSource } from './defaults';
import type { AudioSourceComponent } from './schema';

/**
 * A sound placed in the world.
 *
 * `runtime: true` since the runtime plays sound. What builds it is a behaviour
 * and not a system — `audioSourceBehaviour` in
 * `packages/runtime/src/behaviour/audio.ts` — because a source draws nothing:
 * it holds a voice, and a voice is a Web Audio graph, not an `Object3D`.
 *
 * The flag was `false` for as long as this registry has existed, and it is the
 * reason the registry exists at all. Two tests keep the two halves together:
 * one refuses a flag with no system behind it, the other refuses a system with
 * no flag.
 */
export const audioSourceComponent: ComponentDefinition<AudioSourceComponent> = {
  id: 'audioSource',
  label: 'Audio Source',
  create: () => createAudioSource(),
  assets: (component) => [component.assetId],
  entities: () => [],
  icon: 'volume',
  placeable: () => true,
  runtime: true,
  addable: true,
};
