import { defineComponent } from '../registry';
import { createModel } from './defaults';

/** An imported glTF, FBX or OBJ. */
export const modelComponent = defineComponent({
  type: 'model',
  create: createModel,
  // The material as well as the file. Without it, reference counting and "what
  // does this scene use" both miss a material an imported model is drawing with,
  // which is how an asset still in use gets reported as unused.
  assets: (component) => [component.assetId, component.materialId],
  icon: 'box',
  placeable: () => true,
  runtime: true,
  addable: false,
});
