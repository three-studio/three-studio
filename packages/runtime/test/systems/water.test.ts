import { PlaneGeometry, Texture } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { StudioTime } from '../../src/time/StudioTime';
import { WaterSurface } from '../../src/systems/WaterSurface';

/*
 * The fork of three's `WaterMesh`, on its own.
 *
 * Testable under Node for the reason `sceneBinder.test.ts` gives: `three/webgpu`
 * constructs without a device, and a node graph is data until something draws
 * it. What must never appear here is a renderer.
 */

function surface(time = new StudioTime()) {
  return new WaterSurface(new PlaneGeometry(1, 1), { waterNormals: new Texture(), time });
}

/**
 * The reflector the surface keeps private.
 *
 * Reached by assertion rather than by a method on the class: "how many render
 * targets are you holding" is a question only a test asks, and widening the
 * class to answer it would be the test leaking into the design.
 */
function reflectorOf(water: WaterSurface) {
  return (water as unknown as { reflection: { reflector: ReflectorLike } }).reflection.reflector;
}

interface ReflectorLike {
  resolutionScale: number;
  renderTargets: Map<unknown, unknown>;
}

/** What the shader computes: `time · rate + phase`, read from the two uniforms. */
function offsetAt(water: WaterSurface, elapsed: number): number {
  const inner = water as unknown as { rate: { value: number }; phase: { value: number } };
  return elapsed * inner.rate.value + inner.phase.value;
}

describe('a water surface', () => {
  it('aims its reflector at itself, so nothing is parented under it', () => {
    const water = surface();

    // three's addon adds a bare `Object3D` here to carry the mirror plane. The
    // mesh already is that plane.
    expect(water.children).toHaveLength(0);
  });

  it('starts at the addon’s own settings', () => {
    const water = surface();

    expect(water.speed).toBe(1);
    expect(water.direction).toBe(0);
    expect(water.choppiness.value).toBe(1.5);
    expect(water.resolutionScale).toBe(0.5);
  });

  it('keeps the waves where they are when the speed changes', () => {
    const time = new StudioTime();
    const water = surface(time);
    // Five minutes in, which is where the naive `time · speed` falls apart.
    time.advance(300);

    const before = offsetAt(water, time.elapsed);
    water.speed = 1.05;
    const after = offsetAt(water, time.elapsed);

    // Without the phase this notch would jump the water by fifteen seconds of
    // motion. This is the whole reason the second uniform exists.
    expect(after).toBeCloseTo(before, 5);
  });

  it('still runs faster afterwards', () => {
    const time = new StudioTime();
    const water = surface(time);
    time.advance(300);
    water.speed = 2;

    const at300 = offsetAt(water, time.elapsed);
    time.advance(1);
    const at301 = offsetAt(water, time.elapsed);

    expect(at301 - at300).toBeCloseTo(2, 5);
  });

  it('holds still at a speed of zero, and resumes where it stopped', () => {
    const time = new StudioTime();
    const water = surface(time);
    time.advance(10);
    water.speed = 0;
    const stopped = offsetAt(water, time.elapsed);

    time.advance(60);
    expect(offsetAt(water, time.elapsed)).toBeCloseTo(stopped, 5);

    water.speed = 1;
    expect(offsetAt(water, time.elapsed)).toBeCloseTo(stopped, 5);
  });

  it('refuses a speed that would rewind or poison a uniform', () => {
    const water = surface();
    water.speed = -1;
    expect(water.speed).toBe(1);

    water.speed = Number.NaN;
    expect(water.speed).toBe(1);
  });

  it('turns the flow, and leaves it alone at zero', () => {
    const water = surface();
    const flow = (water as unknown as { flow: { value: { x: number; y: number } } }).flow;

    // The identity, which is what makes the default look the addon's exactly.
    expect(flow.value.x).toBeCloseTo(1);
    expect(flow.value.y).toBeCloseTo(0);

    water.direction = Math.PI / 2;
    expect(water.direction).toBeCloseTo(Math.PI / 2);
    expect(flow.value.x).toBeCloseTo(0);
    expect(flow.value.y).toBeCloseTo(1);
  });

  it('writes the reflection resolution straight through', () => {
    const water = surface();

    water.resolutionScale = 0.25;

    // Read back off the node, not off a field of our own: this is what the
    // reflector re-reads every frame.
    expect(reflectorOf(water).resolutionScale).toBe(0.25);
  });

  it('frees the reflection targets, which disposing the material does not', () => {
    const water = surface();
    let materialDisposed = 0;
    water.material.addEventListener('dispose', () => (materialDisposed += 1));

    water.dispose();

    expect(materialDisposed).toBe(1);
    expect(reflectorOf(water).renderTargets.size).toBe(0);
  });
});
