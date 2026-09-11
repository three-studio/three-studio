import { GEOMETRY_LABELS, createMeshEntity, type GeometryKind } from '@three-studio/core';
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
  label: 'Mesh',
  order: 1,
  entries: KINDS.map(
    (kind): AddMenuEntry =>
      kind === null
        ? null
        : { label: GEOMETRY_LABELS[kind], create: () => createMeshEntity(kind) },
  ),
};
