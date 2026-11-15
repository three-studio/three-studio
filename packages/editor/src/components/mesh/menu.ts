import { createMeshEntity, geometryField, type GeometryKind } from '@three-studio/core';
import type { AddMenuEntry, AddMenuGroup } from '../registry';

/** Ordered the way an author reaches for them, not the way the union declares them. */
const KINDS: readonly (GeometryKind | null)[] = [
  'box',
  'sphere',
  'plane',
  'capsule',
  'cylinder',
  null,
  'circle',
  'ring',
  'torus',
  'torusKnot',
  null,
  'tetrahedron',
  'octahedron',
  'dodecahedron',
  'icosahedron',
];

export const menu: AddMenuGroup = {
  id: 'mesh',
  label: 'Mesh',
  order: 1,
  entries: KINDS.map(
    (kind): AddMenuEntry =>
      kind === null
        ? null
        : { label: geometryField.variants[kind].label, create: () => createMeshEntity(kind) },
  ),
};
