import type { ComponentSchema } from '../../inspector/fields';

export const inspector: ComponentSchema = {
  label: 'Audio Listener',
  fields: [
    { path: ['masterVolume'], label: 'Master volume', type: 'number', min: 0, max: 1, step: 0.01 },
  ],
};
