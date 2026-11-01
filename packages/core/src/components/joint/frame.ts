import type { Vec3 } from '../../scene/primitives';
import type { JointComponent } from './schema';

/**
 * A joint's anchor and axis on its entity, as physics builds it and the gizmo
 * draws it — two readers, so what is drawn and what is built cannot disagree.
 *
 * The anchor is a point, so it takes the entity's scale, as a collider's
 * centre does. The axis is a direction: made unit and turned with its entity,
 * never stretched by its scale, as Unity reads a joint's axis — typed at 45°,
 * it stays at 45° on an entity scaled tall. A zero axis is up, and so is a
 * Fixed or Spring joint's, which turns nothing.
 */
export function jointFrame(joint: JointComponent, scale: Vec3): { anchor: Vec3; axis: Vec3 } {
  const [ax, ay, az] = joint.anchor;
  const anchor: Vec3 = [ax * scale[0], ay * scale[1], az * scale[2]];
  const { motion } = joint;
  const [x, y, z] = motion.kind === 'hinge' || motion.kind === 'slider' ? motion.axis : UP;
  const length = Math.hypot(x, y, z);
  return { anchor, axis: length > 0 ? [x / length, y / length, z / length] : UP };
}

const UP: Vec3 = [0, 1, 0];
