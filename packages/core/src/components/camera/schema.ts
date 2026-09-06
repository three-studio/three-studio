import type { ComponentBase } from '../../scene/primitives';

export type CameraProjection = 'perspective' | 'orthographic';

export const CAMERA_PROJECTION_LABELS: Record<CameraProjection, string> = {
  perspective: 'Perspective',
  orthographic: 'Orthographic',
};

export interface CameraComponent extends ComponentBase {
  type: 'camera';
  projection: CameraProjection;
  fov: number;
  near: number;
  far: number;
  /** Orthographic vertical extent. */
  frustumSize: number;
  /** The camera play mode renders through when no player controller is active. */
  isMain: boolean;
}
