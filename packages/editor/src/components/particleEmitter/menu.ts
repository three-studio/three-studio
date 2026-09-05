import { createParticleEmitterEntity } from '@three-studio/core';
import type { AddMenuGroup } from '../registry';

/**
 * A submenu for one entry, for the reason Water's is one: this is where the
 * things that are an *effect* rather than an object will go — trails and decals
 * are the obvious next two — and moving Particles in later would move it out
 * from under whatever muscle memory it had built by then.
 */
export const menu: AddMenuGroup = {
  label: 'Effects',
  order: 6,
  entries: [{ label: 'Particles', create: () => createParticleEmitterEntity() }],
};
