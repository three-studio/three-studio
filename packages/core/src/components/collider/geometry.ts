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
 * scale has to be folded into the measures. Each axis of a shape takes the
 * entity's scale along it; a round section, which cannot be an ellipse, takes
 * the larger of its two stretches, and a sphere the largest of three, so it
 * encloses what is drawn (Unity's rule). A capsule keeps the span it is drawn
 * with: its radius was once scaled by the largest axis, which lifted a capsule
 * scaled 1.5 × 1 × 1.5 half a metre off the floor its mesh stood on.
 */

/**
 * A shape as physics builds it, in Rapier's own arguments: metres, at the
 * entity's scale, half measures.
 */
export type BuiltShape =
  | { kind: 'box'; halfExtents: Vec3 }
  | { kind: 'sphere'; radius: number }
  | {
      kind: 'capsule';
      radius: number;
      /** Half the straight part, between the centres of its caps. */
      halfHeight: number;
    }
  | {
      kind: 'mesh';
      build: MeshBuild;
      /** The entity's own vertices are built times this, signed. */
      scale: Vec3;
    };

export interface ColliderGeometry {
  shape: BuiltShape;
}

/** A collider's shape built at an entity's world scale, signed, as physics builds it. */
export function colliderGeometry(shape: ColliderShape, scale: Vec3): ColliderGeometry {
  const [kx, ky, kz] = stretch(scale);
  switch (shape.kind) {
    case 'box': {
      const [x, y, z] = shape.size;
      return { shape: { kind: 'box', halfExtents: [half(x) * kx, half(y) * ky, half(z) * kz] } };
    }
    case 'sphere':
      return { shape: { kind: 'sphere', radius: measure(shape.radius) * Math.max(kx, ky, kz) } };
    case 'capsule': {
      const span = half(shape.height) * ky;
      // Never wider than it is tall: squashed, or drawn shorter than its
      // diameter, a capsule is the sphere as tall as it is drawn.
      const radius = Math.min(measure(shape.radius) * Math.max(kx, kz), span);
      const halfHeight = span - radius;
      return {
        shape: halfHeight > 0 ? { kind: 'capsule', radius, halfHeight } : { kind: 'sphere', radius },
      };
    }
    case 'mesh':
      // The vertices take the scale exactly, mirrored included.
      return { shape: { kind: 'mesh', build: shape.build, scale: [scale[0], scale[1], scale[2]] } };
  }
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
  const built = colliderGeometry(shape, [1, 1, 1]).shape;
  switch (built.kind) {
    case 'box':
      return built.halfExtents[1];
    case 'sphere':
      return built.radius;
    case 'capsule':
      return built.halfHeight + built.radius;
    case 'mesh':
      return 0;
  }
}

/** How much each of the shape's own axes is stretched by the entity's scale. */
function stretch(scale: Vec3): Vec3 {
  return [Math.abs(scale[0]), Math.abs(scale[1]), Math.abs(scale[2])];
}

/** A measure as built: a negative one, which only a hand-edited file holds, is none. */
function measure(value: number): number {
  return Math.max(value, 0);
}

function half(value: number): number {
  return measure(value) / 2;
}
