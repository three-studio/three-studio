import type { CameraComponent } from '@three-studio/core';
import type { EntityMarker } from '../registry';
import { Camera, CameraHelper, type Object3D } from 'three/webgpu';
import { annotation, type ComponentHelper, type HelperHandle } from '../../viewport/overlay/ComponentHelper';

/**
 * The frustum of a selected camera.
 *
 * `CameraHelper` re-reads the camera's `projectionMatrix` on every `update()`,
 * so a change of `fov`, `near` or `far` is followed for free — and a change of
 * *projection* is not, because `CameraSystem` answers `'remount'` to that and
 * hands back a different object. `SelectionHelpers` sees the identity change and
 * rebuilds.
 */
export class CameraFrustum implements ComponentHelper<'camera'> {
  readonly type = 'camera';

  mount(_component: CameraComponent, source: Object3D): HelperHandle | null {
    // Narrowed, never asserted. The system builds a camera today; a helper
    // handed anything else draws nothing rather than throwing in the frame loop.
    if (!(source instanceof Camera)) return null;
    return annotation(new CameraHelper(source));
  }
}

/** A camera draws nothing into the scene; it is what the scene is drawn for. */
export const drawsGeometry = false;

/**
 * First of the marked types. A camera rig is what an author is looking for when
 * several marked components sit on one entity, which is the whole reason the
 * ranking exists.
 */
export const marker: EntityMarker = { color: 0x5eb0ff, pixels: 11, priority: 1 };

export const helper = new CameraFrustum();
