import { defineComponent } from '../registry';
import { lightSchema, type LightKind } from './schema';

/**
 * Kinds three applies to the whole scene, wherever the object stands. Here
 * rather than beside `createLight` because the definition below is the only
 * thing that reads it: it is not how a light is made, it is one of the answers
 * a light gives about itself.
 */
const UNPLACED_LIGHTS: ReadonlySet<LightKind> = new Set(['ambient', 'hemisphere']);

/** A light of any of the seven kinds: see `lightSchema`. */
export const lightType = defineComponent({
  id: 'light',
  label: 'Light',
  version: 1,
  schema: lightSchema,
  runtime: true,
  addable: true,
  // The only `false`, and the reason the question is asked of the component
  // rather than of the type: it is answered by the `kind`.
  placeable: (component) => !UNPLACED_LIGHTS.has(component.kind),
});
