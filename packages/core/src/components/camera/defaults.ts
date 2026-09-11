import { createId } from '../../ids';
import { createEntity, type EntityTemplate } from '../../scene/entity';
import type { CameraComponent, CameraProjection } from './schema';

export function createCamera(projection: CameraProjection = 'perspective'): CameraComponent {
  return {
    id: createId(),
    type: 'camera',
    projection,
    fov: 60,
    near: 0.1,
    far: 2000,
    frustumSize: 10,
    isMain: false,
  };
}

export function createCameraEntity(projection: CameraProjection = 'perspective'): EntityTemplate {
  const name = projection === 'orthographic' ? 'Orthographic Camera' : 'Camera';
  const template = createEntity(name, [createCamera(projection)]);
  template.entity.transform.position = [0, 2, 8];
  return template;
}
