import { createEntity, type EntityTemplate } from '../../scene/entity';
import {
  FLAT_KINDS,
  createGeometry,
  geometryField,
  restingOffsetY,
  type GeometryKind,
} from '../../scene/geometry';
import { meshType } from './index';
import type { MeshComponent } from './schema';

/** A mesh of the primitive `kind`, at its defaults otherwise. */
export function createMeshComponent(kind: GeometryKind): MeshComponent {
  return { ...meshType.create(), geometry: createGeometry(kind) };
}

export function createMeshEntity(kind: GeometryKind): EntityTemplate {
  const mesh = createMeshComponent(kind);
  const template = createEntity(geometryField.variants[kind].label, [mesh]);
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
