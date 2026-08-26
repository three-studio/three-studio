import { createAudioSource } from '../scene/defaults';
import { defineComponent } from './registry';

/**
 * A sound placed in the world.
 *
 * `runtime: true` since the audio chantier. What builds it is a behaviour and
 * not a system — `registerBehaviour('audioSource', …)` in
 * `packages/runtime/src/behaviour/audio.ts` — because a source draws nothing:
 * it holds a voice, and a voice is a Web Audio graph, not an `Object3D`.
 *
 * The flag was `false` for as long as this registry has existed, and it is the
 * reason the registry exists at all. Two tests keep the two halves together:
 * one refuses a flag with no system behind it, the other refuses a system with
 * no flag.
 */
export const audioSourceComponent = defineComponent({
  type: 'audioSource',
  create: () => createAudioSource(),
  fill: (stored) => ({ ...createAudioSource(), ...stored }),
  assets: (component) => [component.assetId],
  icon: 'volume',
  runtime: true,
});
