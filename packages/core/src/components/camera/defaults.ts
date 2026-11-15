import { createEntity, type EntityTemplate } from '../../scene/entity';
import { cameraType } from './index';
import type { CameraComponent, CameraProjection } from './schema';

/** A camera at its defaults, of the projection asked for. */
export function createCamera(projection: CameraProjection = 'perspective'): CameraComponent {
  return { ...cameraType.create(), projection };
}

export function createCameraEntity(projection: CameraProjection = 'perspective'): EntityTemplate {
  const name = projection === 'orthographic' ? 'Orthographic Camera' : 'Camera';
  const template = createEntity(name, [createCamera(projection)]);
  template.entity.transform.position = [0, 2, 8];
  return template;
}
