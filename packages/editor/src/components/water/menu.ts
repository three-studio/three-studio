import { createWaterEntity } from '@three-studio/core';
import type { AddMenuGroup } from '../registry';

/**
 * A submenu for one entry, on purpose: this is where the things that are the
 * *scene* rather than an object in it will go — fog and volumes are the obvious
 * next two — and moving Water in later would move it out from under whatever
 * muscle memory it had built by then.
 */
export const menu: AddMenuGroup = {
  label: 'Environment',
  order: 5,
  entries: [{ label: 'Water', create: () => createWaterEntity() }],
};
