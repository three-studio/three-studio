import type { CameraComponent } from '@three-studio/core';
import { Camera, CameraHelper, type Object3D } from 'three/webgpu';
import { annotation, type ComponentHelper, type HelperHandle } from '../ComponentHelper';

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
