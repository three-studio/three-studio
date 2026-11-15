import { createAudioSourceEntity } from '@three-studio/core';
import type { AddMenuGroup } from '../registry';

export const menu: AddMenuGroup = {
  id: 'audioSource',
  label: 'Audio',
  order: 4,
  entries: [{ label: 'Audio Source', create: () => createAudioSourceEntity() }],
};
