import { createId } from '../../ids';
import { createEntity, type EntityTemplate } from '../../scene/entity';
import {
  FLAT_KINDS,
  GEOMETRY_LABELS,
  createGeometry,
  restingOffsetY,
  type GeometryKind,
} from '../../scene/geometry';
import { createMaterial } from '../../scene/material';
import type { MeshComponent } from './schema';

export function createMeshComponent(kind: GeometryKind): MeshComponent {
  return {
    id: createId(),
    type: 'mesh',
    geometry: createGeometry(kind),
    material: createMaterial(),
    materialId: null,
    castShadow: true,
    receiveShadow: true,
  };
}

export function createMeshEntity(kind: GeometryKind): EntityTemplate {
  const mesh = createMeshComponent(kind);
  const template = createEntity(GEOMETRY_LABELS[kind], [mesh]);
  if (FLAT_KINDS.has(kind)) {
    // Authors expect a flat primitive to be ground, not a wall.
    template.entity.transform.rotation = [-Math.PI / 2, 0, 0];
  }
  // Rest primitives on their support instead of half-sunk into it. Read as an
  // offset from wherever the object is being placed, not as a position — see
  // `placementTransform` in the editor.
  template.entity.transform.position = [0, restingOffsetY(mesh.geometry), 0];
  return template;
}
