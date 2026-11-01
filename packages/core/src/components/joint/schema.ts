import type { ComponentBase, Vec3 } from '../../scene/primitives';

/**
 * What a joint leaves free between its two bodies. Each kind carries its own
 * settings and nothing else, as a collider's shape does: one flat bag would
 * give a hinge a stiffness, and the builder's switch could read it.
 */
export type JointMotion =
  | { kind: 'fixed' }
  | {
      kind: 'hinge';
      /**
       * The line it turns about, through the anchor, in its entity's frame:
       * turned with the entity, never stretched by its scale. A zero axis is up.
       */
      axis: Vec3;
    }
  | {
      kind: 'slider';
      /** The line it slides along, through the anchor, as a hinge's axis is read. */
      axis: Vec3;
    }
  | {
      kind: 'spring';
      /**
       * Newtons per metre of stretch. A spring pulls its anchor back to where
       * it was built on the other body, and turns freely about it: under its
       * weight, a body hangs about m·g / stiffness below.
       */
      stiffness: number;
      /** Newton-seconds per metre. */
      damping: number;
    };

export type JointKind = JointMotion['kind'];
export type JointMotionOf<K extends JointKind> = Extract<JointMotion, { kind: K }>;

export const JOINT_KIND_LABELS: Record<JointKind, string> = {
  fixed: 'Fixed',
  hinge: 'Hinge',
  slider: 'Slider',
  spring: 'Spring',
};

export interface JointComponent extends ComponentBase {
  type: 'joint';
  motion: JointMotion;
  /**
   * The entity whose body this entity's is held to, by id: the body that
   * entity moves with — its own Rigid Body, the nearest one up the tree, or its
   * own fixed body if it is level geometry. `null` holds it to the world.
   */
  connectedEntity: string | null;
  /** Where it holds, in this entity's frame and units: a door's hinge on its edge. */
  anchor: Vec3;
}
