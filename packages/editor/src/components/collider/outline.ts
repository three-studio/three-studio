import type { BuiltShape, Vec3 } from '@three-studio/core';

/*
 * The lines a collider is drawn with, worked out from the shape physics builds:
 * the core `colliderGeometry` hands Rapier and the rounding it adds all round.
 * Arithmetic over those numbers and nothing else, so no line can stand where
 * physics builds nothing.
 */

/** Everything physics builds from measures alone. */
export type BuiltPrimitive = Exclude<BuiltShape, { kind: 'mesh' }>;

/**
 * Points on a full circle. A multiple of four, and every arc is cut at each
 * quarter turn it crosses, so a circle's extreme points are among those drawn
 * and an outline reaches exactly as far as its shape does.
 */
const SEGMENTS = 32;
const STEP = (2 * Math.PI) / SEGMENTS;

/** Nearer its axis than this, in metres, a ring would be a dot. */
const ON_AXIS = 1e-9;

/** A point of a round shape's half-section: its distance from the shape's own y axis, and its height. */
type Section = readonly [rho: number, y: number];

/**
 * The lines that draw a built primitive: pairs of points in its own frame, in
 * metres, centred, along its own axes. A rounded shape is drawn as its outside,
 * its core grown by the rounding on every side.
 */
export function outlineOf(shape: BuiltPrimitive): Float32Array {
  return new Float32Array(linesOf(shape));
}

function linesOf(shape: BuiltPrimitive): number[] {
  switch (shape.kind) {
    case 'box':
      return box(shape.halfExtents, shape.rounding);
    case 'sphere':
      // A point grown by its radius. Its section has no straight piece to ring,
      // so its equator is drawn on its own: three great circles.
      return [...revolved([[0, 0]], shape.radius), ...circle(shape.radius, 0)];
    case 'capsule': {
      const { halfHeight: h } = shape;
      return revolved([[0, -h], [0, h]], shape.radius);
    }
    case 'cylinder': {
      const { radius: r, halfHeight: h } = shape;
      return revolved([[0, -h], [r, -h], [r, h], [0, h]], shape.rounding);
    }
    case 'cone': {
      const { radius: r, halfHeight: h } = shape;
      return revolved([[0, -h], [r, -h], [0, h]], shape.rounding);
    }
  }
}

/**
 * A box's 12 edges. Rounded, each edge of the core instead gives the two faces
 * beside it a line, set out by the rounding, and a quarter circle at each of its
 * ends, around the core's corner, from one face to the other.
 */
function box(halfExtents: Vec3, rounding: number): number[] {
  const lines: number[] = [];
  for (const along of [0, 1, 2] as const) {
    const [u, v] = ACROSS[along];
    const length = halfExtents[along];
    for (const su of [-1, 1]) {
      for (const sv of [-1, 1]) {
        // A point by its place along the edge, and how far it stands off the
        // edge on each of the other two axes.
        const at = (a: number, du: number, dv: number): number[] => {
          const point = [0, 0, 0];
          point[along] = a;
          point[u] = su * (halfExtents[u] + du);
          point[v] = sv * (halfExtents[v] + dv);
          return point;
        };
        if (rounding === 0) {
          lines.push(...at(-length, 0, 0), ...at(length, 0, 0));
          continue;
        }
        lines.push(...at(-length, rounding, 0), ...at(length, rounding, 0));
        lines.push(...at(-length, 0, rounding), ...at(length, 0, rounding));
        for (const end of [-length, length]) {
          polyline(
            lines,
            angles(0, Math.PI / 2).map((t) => at(end, rounding * Math.cos(t), rounding * Math.sin(t))),
          );
        }
      }
    }
  }
  return lines;
}

/** The two axes square to each one, in turn. */
const ACROSS = [
  [1, 2],
  [2, 0],
  [0, 1],
] as const;

/**
 * A shape turned about its own y, from its core's half-section: the corners from
 * its foot on the axis to its top on the axis, set out by the rounding, with an
 * arc around each corner.
 *
 * The section is drawn in the four vertical planes of the shape's own axes —
 * its profile in XY and in ZY — and a circle at each end of each straight piece
 * off the axis: a rim, and where a rounding begins.
 */
function revolved(core: readonly Section[], rounding: number): number[] {
  // A corner the rounding swallowed whole, as S5 lets it, is no corner: the
  // side it would start has no direction to face.
  const corners = core.filter((corner, i) => !same(corner, core[i - 1]));

  const section: Section[] = [];
  const rims: Section[] = [];
  // The foot faces down; each side faces out of the section, square to itself.
  let facing = -Math.PI / 2;
  corners.forEach((corner, i) => {
    const next = corners[i + 1];
    const after = next ? Math.atan2(corner[0] - next[0], next[1] - corner[1]) : Math.PI / 2;
    section.push(...arc(corner, rounding, facing, after));
    if (next) {
      // The straight piece from this corner to the next, set out.
      for (const [rho, y] of [corner, next]) {
        const end: Section = [rho + rounding * Math.cos(after), y + rounding * Math.sin(after)];
        if (end[0] > ON_AXIS && !same(end, rims.at(-1))) rims.push(end);
      }
    }
    facing = after;
  });

  const lines: number[] = [];
  for (const [cos, sin] of [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ] as const) {
    polyline(
      lines,
      section.map(([rho, y]) => [rho * cos, y, rho * sin]),
    );
  }
  for (const [rho, y] of rims) lines.push(...circle(rho, y));
  return lines;
}

/** Around a corner of a section, at the rounding, from one facing to the next. */
function arc([rho, y]: Section, radius: number, from: number, to: number): Section[] {
  if (radius === 0) return [[rho, y]];
  return angles(from, to).map((t) => [rho + radius * Math.cos(t), y + radius * Math.sin(t)]);
}

/** `from`, each quarter turn and each step of a circle past it short of `to`, and `to`. */
function angles(from: number, to: number): number[] {
  const turns = [from];
  for (let k = Math.floor(from / STEP) + 1; k * STEP < to; k++) turns.push(k * STEP);
  if (to > from) turns.push(to);
  return turns;
}

/** A ring about the shape's own y, at this distance and height. */
function circle(rho: number, y: number): number[] {
  const ring = angles(0, 2 * Math.PI).map((t) => [rho * Math.cos(t), y, rho * Math.sin(t)]);
  const lines: number[] = [];
  polyline(lines, ring);
  return lines;
}

/** Joins each point to the next, as pairs. */
function polyline(lines: number[], points: readonly (readonly number[])[]): void {
  points.forEach((point, i) => {
    const next = points[i + 1];
    if (next) lines.push(...point, ...next);
  });
}

function same(a: Section, b: Section | undefined): boolean {
  return b !== undefined && a[0] === b[0] && a[1] === b[1];
}
