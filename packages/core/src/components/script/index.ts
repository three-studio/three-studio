import { defineComponent } from '../registry';
import { createScript } from './defaults';

/** A user script and its declared properties. */
export const scriptComponent = defineComponent({
  type: 'script',
  create: createScript,
  assets: (component) => [component.assetId],
  icon: 'file-code',
  placeable: () => true,
  runtime: true,
  addable: true,
});
