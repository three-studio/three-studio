import type { CameraComponent } from '@three-studio/core';
import { OrthographicCamera, PerspectiveCamera, type Object3D } from 'three/webgpu';
import { ComponentSystem, type SystemContext, type SystemHandle } from './ComponentSystem';
import { ENTITY_ID_KEY } from './identity';

export interface CameraHandle extends SystemHandle {
  camera: PerspectiveCamera | OrthographicCamera;
  projection: CameraComponent['projection'];
  readonly objects: readonly Object3D[];
}

/**
 * The camera a scene defines, for play mode to render through.
 *
 * The one system whose `unmount` frees nothing, and that is not an oversight
 * worth tidying away: a camera owns nothing on the GPU and three gives it no
 * `dispose`. Adding one alongside the lights threw
 * `disposable.dispose is not a function` on the first Stop.
 */
export class CameraSystem extends ComponentSystem<CameraComponent, CameraHandle> {
  readonly type = 'camera' as const;

  mount(entityId: string, component: CameraComponent, _ctx: SystemContext): CameraHandle {
    const camera = buildCamera(component);
    camera.userData[ENTITY_ID_KEY] = entityId;
    return { camera, projection: component.projection, objects: [camera] };
  }

  patch(
    handle: CameraHandle,
    _previous: CameraComponent,
    next: CameraComponent,
    _ctx: SystemContext,
  ): CameraHandle | 'remount' {
    // A perspective and an orthographic camera are different classes.
    if (handle.projection !== next.projection) return 'remount';

    const camera = handle.camera;
    if (camera instanceof PerspectiveCamera) {
      camera.fov = next.fov;
      camera.near = next.near;
      camera.far = next.far;
      camera.updateProjectionMatrix();
      return handle;
    }

    const half = next.frustumSize / 2;
    camera.left = -half;
    camera.right = half;
    camera.top = half;
    camera.bottom = -half;
    camera.near = next.near;
    camera.far = next.far;
    camera.updateProjectionMatrix();
    return handle;
  }

  /**
   * Nothing to free. What a discarded camera does leave behind is
   * `Engine.documentCamera` pointing at an object nothing draws — a dangling
   * reference rather than a leak, and the patch path above is what stops one
   * being created on every edit.
   */
  unmount(_handle: CameraHandle, _ctx: SystemContext): void {}
}

function buildCamera(def: CameraComponent): PerspectiveCamera | OrthographicCamera {
  if (def.projection === 'orthographic') {
    const half = def.frustumSize / 2;
    return new OrthographicCamera(-half, half, half, -half, def.near, def.far);
  }
  return new PerspectiveCamera(def.fov, 16 / 9, def.near, def.far);
}
