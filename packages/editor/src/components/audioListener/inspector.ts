import type { ComponentPane } from '../../inspector/fields';

export const pane: ComponentPane = {
  id: 'audioListener',
  fields: [
    { path: ['masterVolume'], label: 'Master volume', type: 'number', min: 0, max: 1, step: 0.01 },
  ],
};
