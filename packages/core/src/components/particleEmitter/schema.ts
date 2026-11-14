import type { Infer, Schema } from '../../fieldSchema';
import type { Component } from '../../scene/primitives';

/**
 * A stream of billboarded particles, as its fields.
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
 *
 * The order is the pane's. The defaults are a slow plume of warm embers,
 * drifting upward: chosen so that an emitter dropped into a scene is visibly
 * *something* before a single field is touched — which the obvious defaults are
 * not: a point source with no spread and no velocity draws every particle in
 * one place, and reads as a single sprite stuck to the gizmo.
 */
export const particleEmitterSchema = {
  /*
   * Where a particle is born, relative to the emitter. Three distributions
   * rather than a size with a "spread" knob: a point, a ball and a box are what
   * every editor offers, and each reads the two fields below it differently —
   * which is what makes them conditional rather than always shown.
   *
   * First, as on a mesh and on a water surface: it is what the emitter *is*,
   * and the two rows below it change with this one. A ball rather than a point
   * by default: an emitter with a volume shows what its two shape fields are
   * for the moment it is added.
   */
  shape: {
    type: 'enum',
    label: 'Emit from',
    default: 'sphere',
    options: [
      { value: 'point', label: 'Point' },
      { value: 'sphere', label: 'Sphere' },
      { value: 'box', label: 'Box' },
    ],
  },
  /*
   * The two shape fields, each shown for the one shape that reads it. A radius
   * means nothing to a box and extents mean nothing to a ball, and showing both
   * at once was the version that had to be looked at to be rejected: three
   * numbers that do nothing sit above three that do, and there is nothing on
   * screen to say which is which.
   */
  radius: {
    type: 'number',
    label: 'Radius',
    default: 0.25,
    min: 0,
    max: 50,
    step: 0.05,
    shownWhen: { field: 'shape', equals: 'sphere' },
  },
  /*
   * Full width, height and depth — not half-extents.
   *
   * Not "Size": there is a particle Size further down, and two rows under one
   * heading reading the same word is a pane nobody can scan. Seen in the editor
   * rather than reasoned about — the two sit one screen apart on the panel.
   */
  extents: {
    type: 'vec3',
    label: 'Box size',
    default: [1, 1, 1],
    min: 0,
    step: 0.1,
    shownWhen: { field: 'shape', equals: 'box' },
  },
  /*
   * How many particles are alive at once. Alive *at once*, not per second: the
   * two are the same statement here, since a particle is reborn the instant it
   * dies. Emission rate is `count / lifetime`, which is why there is no
   * separate rate field to disagree with it.
   *
   * Two hundred is small enough to be free on any machine and large enough to
   * look like a stream rather than a handful of dots. The row is capped well
   * below the system's own ceiling: a hundred thousand is what a hand-edited
   * file may ask for, five thousand is what a slider should offer.
   */
  count: { type: 'number', label: 'Particles', default: 200, min: 0, max: 5000, step: 1, separatorBefore: true },
  /*
   * Seconds a particle lives before it is born again at the emitter. Labelled
   * for the span rather than for the rate, which has no field of its own.
   */
  lifetime: { type: 'number', label: 'Lifetime (s)', default: 2, min: 0.1, max: 30, step: 0.1 },
  /* Metres per second, in the emitter's own frame. */
  velocity: { type: 'vec3', label: 'Velocity', default: [0, 1.5, 0], step: 0.1, separatorBefore: true },
  /* Added to `velocity`, at random per particle, between minus and plus this. Zero on every axis is a beam. */
  spread: { type: 'vec3', label: 'Spread', default: [0.4, 0.4, 0.4], min: 0, step: 0.1 },
  /*
   * Downward acceleration in metres per second squared. `0` lets particles
   * drift; `9.81` makes them fall.
   *
   * A single number rather than a vector because it is the emitter's frame that
   * decides which way "down" is, and an emitter tipped on its side wanting
   * sideways gravity is asking for a wind, which this is not.
   */
  gravity: { type: 'number', label: 'Gravity', default: 0, min: -20, max: 20, step: 0.1 },
  /* The sprite each particle draws. A soft disc is used until one is set. */
  spriteId: { type: 'asset', label: 'Sprite', kind: 'texture', separatorBefore: true },
  color: { type: 'color', label: 'Colour', default: '#ffb86b' },
  /* Width of a particle in metres, before the emitter's own scale. */
  size: { type: 'number', label: 'Size', default: 0.15, min: 0.001, max: 10, step: 0.01 },
  /* Opacity at birth. A particle always fades to nothing as it dies. */
  opacity: { type: 'number', label: 'Opacity', default: 1, min: 0, max: 1, step: 0.01 },
  /* Whether particles add to what is behind them, as sparks and fire do. */
  additive: { type: 'boolean', label: 'Additive', default: true },
} as const satisfies Schema;

/** A stream of billboarded particles: see `particleEmitterSchema`, which it is typed from. */
export type ParticleEmitterComponent = Component<'particleEmitter', Infer<typeof particleEmitterSchema>>;
