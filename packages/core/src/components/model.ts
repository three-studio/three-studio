import { blankComponent as blank } from '../scene/defaults';
import { defineComponent } from './registry';

/** An imported glTF, FBX or OBJ. */
export const modelComponent = defineComponent({
  type: 'model',
  create: () => blank('model'),
  // A shallow spread is enough, and that is why `nodePath`, `nodeName` and
  // `materialId` are three flat fields rather than one `node: { … }` object: a
  // sub-object would need the deeper merge `meshComponent.fill` documents, and
  // the day someone forgot it is the day a stored model came back with
  // `undefined` where three expects a string.
  fill: (stored) => ({ ...blank('model'), ...stored }),
  // The material as well as the file. Without it, reference counting and "what
  // does this scene use" both miss a material an imported model is drawing with,
  // which is how an asset still in use gets reported as unused.
  assets: (component) => [component.assetId, component.materialId],
  icon: 'box',
  runtime: true,
});
