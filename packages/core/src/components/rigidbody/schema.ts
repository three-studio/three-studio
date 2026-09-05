import type { ComponentBase } from '../../scene/primitives';

export interface RigidBodyComponent extends ComponentBase {
  type: 'rigidbody';
  bodyType: 'fixed' | 'dynamic' | 'kinematicPosition';
  mass: number;
  linearDamping: number;
  angularDamping: number;
  gravityScale: number;
  /** Continuous collision detection: costly, needed for fast small bodies. */
  ccd: boolean;
}
