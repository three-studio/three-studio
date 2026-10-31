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
  /**
   * Drawn between its last two physics steps rather than at the last one.
   *
   * The step runs at a fixed rate and the screen at its own. Drawn at its last
   * step, a body stood still on every other frame of a 120 Hz display, and on
   * most frames in slow motion. The price is a drawn pose up to one step behind
   * the solver. Read for a dynamic body: a kinematic one is drawn where its
   * transform is, and a character's always this way.
   */
  interpolate: boolean;
  /** World axes the solver may not move it along, x, y, z. A dynamic body only. */
  lockPosition: [boolean, boolean, boolean];
  /** World axes it may not turn about, x, y, z. A dynamic body only. */
  lockRotation: [boolean, boolean, boolean];
}
