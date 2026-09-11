import type { ComponentBase, Hex, Vec3 } from '../../scene/primitives';

/**
 * Where a particle is born, relative to the emitter.
 *
 * Three distributions rather than a size with a "spread" knob: a point, a ball
 * and a box are what every editor offers, and each reads the two fields below
 * differently — which is what makes them conditional rather than always shown.
 */
export type EmitterShape = 'point' | 'sphere' | 'box';

export const EMITTER_SHAPE_LABELS: Record<EmitterShape, string> = {
  point: 'Point',
  sphere: 'Sphere',
  box: 'Box',
};

/**
 * A stream of billboarded particles.
 *
 * Deliberately the simplest thing that is still worth having: a fixed number of
 * particles, each born inside the emitter, carried by a velocity and a constant
 * acceleration, and reborn when its lifetime runs out. No bursts, no sub-
 * emitters, no curves. Everything here is either a per-particle constant or a
 * uniform, which is what lets the whole system be one draw call and one shader
 * that never has to be rebuilt while a slider is dragged.
 *
 * Distances are metres and times are seconds, as everywhere else in the
 * document; the emitter's own transform is what places and turns it, so
 * `velocity` and `spread` are read in its local frame.
 */
export interface ParticleEmitterComponent extends ComponentBase {
  type: 'particleEmitter';
  /**
   * How many particles are alive at once.
   *
   * Alive *at once*, not per second: the two are the same statement here, since
   * a particle is reborn the instant it dies. Emission rate is `count /
   * lifetime`, which is why there is no separate rate field to disagree with it.
   */
  count: number;
  shape: EmitterShape;
  /** Sphere only. */
  radius: number;
  /** Box only. Full width, height and depth — not half-extents. */
  extents: Vec3;
  /** Seconds a particle lives before it is born again at the emitter. */
  lifetime: number;
  /** Metres per second, in the emitter's own frame. */
  velocity: Vec3;
  /** Added to `velocity`, at random per particle, between minus and plus this. */
  spread: Vec3;
  /**
   * Downward acceleration in metres per second squared. `0` lets particles
   * drift; `9.81` makes them fall.
   *
   * A single number rather than a vector because it is the emitter's frame that
   * decides which way "down" is, and an emitter tipped on its side wanting
   * sideways gravity is asking for a wind, which this is not.
   */
  gravity: number;
  /** Width of a particle in metres, before the emitter's own scale. */
  size: number;
  color: Hex;
  /** Opacity at birth. A particle always fades to nothing as it dies. */
  opacity: number;
  /** The sprite each particle draws. A soft disc is used until one is set. */
  spriteId: string | null;
  /** Whether particles add to what is behind them, as sparks and fire do. */
  additive: boolean;
}
