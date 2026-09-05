import { createLightEntity, type LightKind } from '@three-studio/core';
import type { AddMenuGroup } from '../registry';

/**
 * Shorter than the entity names: the submenu title already says "Light".
 *
 * Ordered by how often one is reached for, not alphabetically — and the two
 * scene-wide kinds sit last because they are the ones that ignore where they
 * are put.
 */
const LABELS: Record<LightKind, string> = {
  directional: 'Directional',
  point: 'Point',
  spot: 'Spot',
  rectArea: 'Area',
  projector: 'Projector',
  ambient: 'Ambient',
  hemisphere: 'Hemisphere',
};

export const menu: AddMenuGroup = {
  label: 'Light',
  order: 2,
  entries: (Object.keys(LABELS) as LightKind[]).map((kind) => ({
    label: LABELS[kind],
    create: () => createLightEntity(kind),
  })),
};
