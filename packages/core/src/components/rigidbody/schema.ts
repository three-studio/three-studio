import type { ComponentBase } from '../../scene/primitives';

/** `kinematicPosition` is driven by a target pose rather than by forces. */
export type BodyType = 'fixed' | 'dynamic' | 'kinematicPosition';

export const BODY_TYPE_LABELS: Record<BodyType, string> = {
  dynamic: 'Dynamic',
  fixed: 'Fixed',
  kinematicPosition: 'Kinematic',
};

export interface RigidBodyComponent extends ComponentBase {
  type: 'rigidbody';
  bodyType: BodyType;
  mass: number;
  linearDamping: number;
  angularDamping: number;
  gravityScale: number;
  /** Continuous collision detection: costly, needed for fast small bodies. */
  ccd: boolean;
}
