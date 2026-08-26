import { blankComponent as blank } from '../scene/defaults';
import { defineComponent } from './registry';

/** A user script and its declared properties. */
export const scriptComponent = defineComponent({
  type: 'script',
  create: () => blank('script'),
  fill: (stored) => ({ ...blank('script'), ...stored }),
  assets: (component) => [component.assetId],
  icon: 'file-code',
  runtime: true,
});
