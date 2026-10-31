import type { Vec3 } from '../../scene/primitives';
import type { ColliderShape, MeshBuild } from './schema';

/*
 * A collider as physics builds it, from the shape the author measured as drawn.
 *
 * The rules are here and nowhere else. The runtime builds from them, and so will
 * everything else that has to agree with what is built — what is drawn of a
 * collider, where a character's feet are — so the two cannot disagree.
 *
 * Rapier has no scaled shape: a box scaled 2× is a box twice the size, and the
 * scale has to be folded into the measures. Each of a shape's own axes takes
 * the entity's scale along it; a round section, which cannot be an ellipse,
 * takes the larger of its two stretches, and a sphere the largest of three, so
 * it encloses what is drawn (Unity's rule). A capsule keeps the span it is
 * drawn with: its radius was once scaled by the largest axis, which lifted a
 * capsule scaled 1.5 × 1 × 1.5 half a metre off the floor its mesh stood on.
 *
 * A shape turned on a non-uniformly scaled entity is drawn sheared, which no
 * Rapier shape is. Exact when the turn keeps to the entity's axes or the scale
 * is uniform; otherwise the stretch along each of the shape's own axes is the
 * best fit there is.
 */

/**
 * A shape as physics builds it, in Rapier's own arguments: metres, at the
 * entity's scale, half measures. A rounded shape is the core it rounds and the
 * `rounding` it adds all round, so its outside is where the shape is drawn.
 */
export type BuiltShape =
  | { kind: 'box'; halfExtents: Vec3; rounding: number }
  | { kind: 'sphere'; radius: number }
  | {
      kind: 'capsule';
      radius: number;
      /** Half the straight part, between the centres of its caps. */
      halfHeight: number;
    }
  | { kind: 'cylinder'; radius: number; halfHeight: number; rounding: number }
  /** Its base at −`halfHeight` along its own y, its apex at +`halfHeight`. */
  | { kind: 'cone'; radius: number; halfHeight: number; rounding: number }
  | {
      kind: 'mesh';
      build: MeshBuild;
      /** The entity's own vertices are built times this, signed. */
      scale: Vec3;
    };

export interface ColliderGeometry {
  shape: BuiltShape;
  /** The shape's middle on its body: the collider's centre at the entity's scale. */
  position: Vec3;
  /** How it is turned on its body, Euler XYZ in radians. */
  rotation: Vec3;
}

/** A collider's shape built at an entity's world scale, signed, as physics builds it. */
export function colliderGeometry(shape: ColliderShape, scale: Vec3): ColliderGeometry {
  if (shape.kind === 'mesh') {
    // The vertices take the scale exactly, mirrored included, and are already
    // where they are drawn.
    return {
      shape: { kind: 'mesh', build: shape.build, scale: [scale[0], scale[1], scale[2]] },
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    };
  }

  // A centre is a point, so it takes the scale exactly.
  const [cx, cy, cz] = shape.center;
  const position: Vec3 = [cx * scale[0], cy * scale[1], cz * scale[2]];
  if (shape.kind === 'sphere') {
    const radius = measure(shape.radius) * Math.max(...stretch(scale, [0, 0, 0]));
    return { shape: { kind: 'sphere', radius }, position, rotation: [0, 0, 0] };
  }

  const [rx, ry, rz] = shape.rotation;
  return { shape: turned(shape, stretch(scale, shape.rotation)), position, rotation: [rx, ry, rz] };
}

/** A shape with a rotation, built with each of its own axes stretched by `k`. */
function turned(
  shape: Exclude<ColliderShape, { kind: 'sphere' | 'mesh' }>,
  [kx, ky, kz]: Vec3,
): BuiltShape {
  switch (shape.kind) {
    case 'box': {
      const [x, y, z] = shape.size;
      const outside: Vec3 = [half(x) * kx, half(y) * ky, half(z) * kz];
      const rounding = rounded(shape.rounding, [kx, ky, kz], Math.min(...outside));
      const [hx, hy, hz] = outside;
      return { kind: 'box', halfExtents: [hx - rounding, hy - rounding, hz - rounding], rounding };
    }
    case 'capsule': {
      const span = half(shape.height) * ky;
      // Never wider than it is tall: squashed, or drawn shorter than its
      // diameter, a capsule is the sphere as tall as it is drawn.
      const radius = Math.min(measure(shape.radius) * Math.max(kx, kz), span);
      const halfHeight = span - radius;
      return halfHeight > 0 ? { kind: 'capsule', radius, halfHeight } : { kind: 'sphere', radius };
    }
    case 'cylinder':
    case 'cone': {
      // For a cone the core keeps its span and its base's radius exactly; near
      // the apex, the rounding bulges a little past the drawn sides.
      const radius = measure(shape.radius) * Math.max(kx, kz);
      const halfHeight = half(shape.height) * ky;
      const rounding = rounded(shape.rounding, [kx, ky, kz], Math.min(radius, halfHeight));
      return {
        kind: shape.kind,
        radius: radius - rounding,
        halfHeight: halfHeight - rounding,
        rounding,
      };
    }
  }
}

/**
 * A rounding as built: stretched by the least the shape is, so it never rounds
 * past the flattest side, and never more than the shape's smallest half
 * measure, so the core it rounds is never turned inside out.
 */
function rounded(rounding: number, stretches: Vec3, smallestHalf: number): number {
  return Math.min(measure(rounding) * Math.min(...stretches), smallestHalf);
}

/**
 * How far below its entity's origin a collider reaches, in the entity's own
 * units: where a character's feet are.
 *
 * Physics centres a shape on the body it hangs from — a capsule and a cuboid
 * both straddle the origin — so an entity's origin is its *middle*, not its
 * feet. Anything that wants to place something at ground level has to subtract
 * this, and `PlayerController` is the one that taught us so: `eyeHeight` was
 * measured from the origin, which put the default player's eye at 2.2 m for a
 * character 1 m tall, with no way to work out the offset from the Inspector.
 *
 * **Zero for a mesh is an answer, not a shrug.** A mesh collider is built from
 * the entity's own geometry in its own local space, so the origin is already
 * wherever the author put it — usually the feet, for a model exported to stand
 * on a floor. It is also the only answer the scene migration can give, having
 * no geometry to measure, and the two must agree or a migrated scene and a
 * running one would disagree about the ground.
 *
 * Unscaled, like `eyeHeight` itself: both are read in the entity's own units.
 * Physics does scale the shape, so a player entity at anything other than
 * scale 1 keeps the mismatch it has always had — correcting one half of it here
 * would be a second, invisible change of behaviour on top of the one that was
 * wanted.
 */
export function originAboveFeet(shape: ColliderShape): number {
  const { shape: built, position, rotation } = colliderGeometry(shape, [1, 1, 1]);
  if (built.kind === 'mesh') return 0;
  // How far each of the shape's own axes points up.
  const [x, y, z] = axesOf(rotation);
  return reachBelow(built, [x[1], y[1], z[1]]) - position[1];
}

/**
 * How far a shape reaches below its middle — its support along −y — given how
 * far each of its own axes points up.
 */
function reachBelow(built: Exclude<BuiltShape, { kind: 'mesh' }>, up: Vec3): number {
  const [ux, uy, uz] = up;
  switch (built.kind) {
    // A rounded shape reaches its rounding further than the core it rounds.
    case 'box': {
      const [hx, hy, hz] = built.halfExtents;
      return Math.abs(ux) * hx + Math.abs(uy) * hy + Math.abs(uz) * hz + built.rounding;
    }
    case 'sphere':
      return built.radius;
    case 'capsule':
      return Math.abs(uy) * built.halfHeight + built.radius;
    case 'cylinder':
      return Math.abs(uy) * built.halfHeight + built.radius * tilt(uy) + built.rounding;
    case 'cone':
      // The apex, or the lowest point of the base's rim.
      return (
        Math.max(-built.halfHeight * uy, built.halfHeight * uy + built.radius * tilt(uy)) +
        built.rounding
      );
  }
}

/** How far a disc square to an axis reaches down, per metre of radius: the sine of its tilt. */
function tilt(upward: number): number {
  return Math.sqrt(Math.max(0, 1 - upward * upward));
}

/**
 * A shape's own axes in its entity's frame: the columns of its rotation, three's
 * Euler XYZ (`R = Rx · Ry · Rz`), written out as `Matrix4.makeRotationFromEuler`
 * writes it, so a shape turns here as the builder turns it through
 * `Quaternion.setFromEuler`.
 */
function axesOf([x, y, z]: Vec3): [Vec3, Vec3, Vec3] {
  const a = Math.cos(x);
  const b = Math.sin(x);
  const c = Math.cos(y);
  const d = Math.sin(y);
  const e = Math.cos(z);
  const f = Math.sin(z);
  return [
    [c * e, a * f + b * e * d, b * f - a * e * d],
    [-c * f, a * e - b * f * d, b * e + a * f * d],
    [d, -b * c, a * c],
  ];
}

/** How much each of a shape's own axes is stretched by the entity's scale. */
function stretch(scale: Vec3, rotation: Vec3): Vec3 {
  const [sx, sy, sz] = scale;
  const along = ([x, y, z]: Vec3): number => Math.hypot(sx * x, sy * y, sz * z);
  const [x, y, z] = axesOf(rotation);
  return [along(x), along(y), along(z)];
}

/** A measure as built: a negative one, which only a hand-edited file holds, is none. */
function measure(value: number): number {
  return Math.max(value, 0);
}

function half(value: number): number {
  return measure(value) / 2;
}
