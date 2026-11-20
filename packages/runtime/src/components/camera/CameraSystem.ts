import type { CameraComponent, Disposable, EntityId } from '@three-studio/core';
import { OrthographicCamera, PerspectiveCamera, type Object3D } from 'three/webgpu';
import { ComponentSystem, type SystemContext, type SystemHandle } from '../../systems/ComponentSystem';
import { ENTITY_ID_KEY } from '../../systems/identity';
import { CAMERA_PRIORITY } from '../../world/cameras';

export interface CameraHandle extends SystemHandle {
  camera: PerspectiveCamera | OrthographicCamera;
  projection: CameraComponent['projection'];
  isMain: boolean;
  /** Its claim on the view, given back when it goes or when it is marked main or no longer. */
  claim: Disposable;
  readonly objects: readonly Object3D[];
}

/**
 * The camera a scene defines, claiming the view for play mode to render
 * through: as the scene's main camera, or as one it merely holds. Claimed in
 * the order the cameras mount, which is the scene's: the first main camera
 * wins, else the first camera.
 *
 * The one system whose `unmount` frees nothing on the GPU, and that is not an
 * oversight worth tidying away: a camera owns nothing there and three gives it
 * no `dispose`. Adding one alongside the lights threw
 * `disposable.dispose is not a function` on the first Stop.
 */
export class CameraSystem extends ComponentSystem<CameraComponent, CameraHandle> {
  /** How many mounted cameras are marked main: two is a line, and a common slip — one prefab placed twice. */
  private mains = 0;

  mount(entityId: EntityId, component: CameraComponent, ctx: SystemContext): CameraHandle {
    const camera = buildCamera(component);
    camera.userData[ENTITY_ID_KEY] = entityId;
    if (component.isMain) this.mains += 1;
    return {
      camera,
      projection: component.projection,
      isMain: component.isMain,
      claim: ctx.cameras.claim(camera, priorityOf(component)),
      objects: [camera],
    };
  }

  patch(
    handle: CameraHandle,
    _previous: CameraComponent,
    next: CameraComponent,
    ctx: SystemContext,
  ): CameraHandle | 'remount' {
    // A perspective and an orthographic camera are different classes.
    if (handle.projection !== next.projection) return 'remount';

    if (handle.isMain !== next.isMain) {
      this.mains += next.isMain ? 1 : -1;
      handle.isMain = next.isMain;
      handle.claim.dispose();
      handle.claim = ctx.cameras.claim(handle.camera, priorityOf(next));
    }

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
   * Gives the view back, so nothing is drawn through a camera nothing draws;
   * nothing to free.
   */
  unmount(handle: CameraHandle, _ctx: SystemContext): void {
    if (handle.isMain) this.mains -= 1;
    handle.claim.dispose();
  }

  override diagnose(): readonly string[] {
    return this.mains > 1 ? [`${this.mains} cameras are marked main; the first one is used.`] : [];
  }
}

function priorityOf(component: CameraComponent): number {
  return component.isMain ? CAMERA_PRIORITY.main : CAMERA_PRIORITY.authored;
}

function buildCamera(def: CameraComponent): PerspectiveCamera | OrthographicCamera {
  if (def.projection === 'orthographic') {
    const half = def.frustumSize / 2;
    return new OrthographicCamera(-half, half, half, -half, def.near, def.far);
  }
  return new PerspectiveCamera(def.fov, 16 / 9, def.near, def.far);
}
