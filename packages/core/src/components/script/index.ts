import { defineComponent } from '../registry';
import { createScript } from './defaults';

/** A user script and its declared properties. */
export const scriptComponent = defineComponent({
  type: 'script',
  create: createScript,
  assets: (component) => [component.assetId],
  // Every string property, since only the script knows which hold assets.
  assetCandidates: (component) =>
    Object.values(component.props).filter((value): value is string => typeof value === 'string'),
  icon: 'file-code',
  placeable: () => true,
  runtime: true,
  addable: true,
});
