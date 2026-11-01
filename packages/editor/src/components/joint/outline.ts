import type { JointMotion, Vec3 } from '@three-studio/core';

/*
 * The lines a joint is drawn with, in its own frame: the anchor at the origin
 * and X along the axis it frees, as physics builds it. Arithmetic over the
 * component's numbers and nothing else.
 */

/** Points on a full circle; an arc takes its share of them, and at least one. */
const SEGMENTS = 32;
const STEP = (2 * Math.PI) / SEGMENTS;

/**
 * The lines that draw a joint: pairs of points in its own frame, the anchor at
 * the origin and X along its axis. Every kind has a cross at the anchor,
 * `size / 5` across. A hinge adds its axis, `size` each side, and the circle it
 * turns on, or with limits the arc of its range and a needle along `zero`, the
 * direction it was built at: unit, across X. A slider adds its axis, or with
 * limits the stretch of its range with a tick across each end.
 */
export function jointOutline(motion: JointMotion, size: number, zero: Vec3): Float32Array {
  const tick = size / 10;
  const lines = [-tick, 0, 0, tick, 0, 0, 0, -tick, 0, 0, tick, 0, 0, 0, -tick, 0, 0, tick];
  switch (motion.kind) {
    case 'fixed':
    case 'spring':
      break;
    case 'hinge': {
      lines.push(-size, 0, 0, size, 0, 0);
      const { enabled, min, max } = motion.limits;
      if (!enabled) {
        lines.push(...arc(zero, size, 0, 2 * Math.PI));
        break;
      }
      lines.push(0, 0, 0, 0, size * zero[1], size * zero[2]);
      lines.push(...arc(zero, size, Math.min(min, max), Math.max(min, max)));
      break;
    }
    case 'slider': {
      const { enabled, min, max } = motion.limits;
      if (!enabled) {
        lines.push(-size, 0, 0, size, 0, 0);
        break;
      }
      const [low, high] = [Math.min(min, max), Math.max(min, max)];
      lines.push(low, 0, 0, high, 0, 0);
      for (const end of [low, high]) {
        lines.push(end, -tick * zero[1], -tick * zero[2], end, tick * zero[1], tick * zero[2]);
      }
      break;
    }
  }
  return new Float32Array(lines);
}

/** From `from` to `to` radians about X, right-handed, at `radius`, starting from `zero`. */
function arc(zero: Vec3, radius: number, from: number, to: number): number[] {
  const count = Math.max(1, Math.ceil((to - from) / STEP));
  const at = (angle: number): number[] => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // `zero` turned about X: cos · zero + sin · (X × zero).
    return [0, radius * (cos * zero[1] - sin * zero[2]), radius * (cos * zero[2] + sin * zero[1])];
  };
  const lines: number[] = [];
  for (let i = 0; i < count; i++) {
    lines.push(...at(from + ((to - from) * i) / count), ...at(from + ((to - from) * (i + 1)) / count));
  }
  return lines;
}
