import { Euler, Quaternion, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { arcStart, gestureAxis, gizmoUnit } from '../src/viewport/RotationReadout';

/*
 * The three answers the readout has to get right before it draws anything.
 *
 * Pure and tested here rather than left inside the class, because each of them
 * fails *quietly*: a sector in the wrong plane, anchored at the wrong angle, or
 * an eighth of a unit too wide all look like a sector until you turn the object
 * twice and notice it never lined up with the ring.
 */

const near = (vector: Vector3) => [vector.x, vector.y, vector.z].map((v) => Number(v.toFixed(6)));

/** A quarter turn about Y — the frame the pivot is in when the object is turned. */
const quarterTurnY = new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0));

describe('which plane the sector lies in', () => {
  it('turns the axis into world space on the local branch', () => {
    // Three left `rotationAxis` as the bare unit X, in the pivot's own frame.
    const axis = gestureAxis({
      handle: 'X',
      space: 'local',
      rotationAxis: new Vector3(1, 0, 0),
      frame: quarterTurnY,
    });
    // A quarter turn about Y carries x̂ onto −ẑ.
    expect(near(axis)).toEqual([0, 0, -1]);
  });

  it('leaves the axis alone on every other branch, where three already did the work', () => {
    // `applyQuaternion( _parentQuaternionInv )` has run, and that parent is
    // `transformGizmo`, which the projection guarantees is the identity.
    const axis = gestureAxis({
      handle: 'X',
      space: 'world',
      rotationAxis: new Vector3(1, 0, 0),
      frame: quarterTurnY,
    });
    expect(near(axis)).toEqual([1, 0, 0]);
  });

  it('leaves the screen-space handle alone even in local space', () => {
    // `E` and `XYZE` take the `else` branch whatever the space, so converting
    // them would turn a correct axis into a wrong one.
    const axis = gestureAxis({
      handle: 'E',
      space: 'local',
      rotationAxis: new Vector3(0, 0, 1),
      frame: quarterTurnY,
    });
    expect(near(axis)).toEqual([0, 0, 1]);
  });
});

describe('where the sector starts', () => {
  it('flattens the grabbed point into the plane of the rotation', () => {
    const start = arcStart(new Vector3(0, 1, 0), new Vector3(2, 5, 0));
    expect(near(start)).toEqual([1, 0, 0]);
  });

  it('finds a perpendicular when the grab is straight down the axis', () => {
    // The ring seen edge-on, with the pointer on its centre. There is no
    // projection to take, and returning a zero vector would collapse the fan.
    const axis = new Vector3(0, 1, 0);
    const start = arcStart(axis, new Vector3(0, 3, 0));

    expect(start.length()).toBeCloseTo(1, 6);
    expect(start.dot(axis)).toBeCloseTo(0, 6);
  });
});

describe('how wide the sector is', () => {
  it('reproduces the scale three gives its own handles', () => {
    // 1.9·tan(30°)·10 · 0.85 / 4, which is the ring's own world radius times two.
    expect(gizmoUnit({ distance: 10, fovDegrees: 60, zoom: 1, size: 0.85 })).toBeCloseTo(
      2.3310517,
      6,
    );
  });

  it('honours the ceiling three puts on it, which stops a wide lens filling the view', () => {
    // 1.9·tan(85°)/0.1 is about 217; three caps the factor at 7.
    expect(gizmoUnit({ distance: 2, fovDegrees: 170, zoom: 0.1, size: 1 })).toBeCloseTo(3.5, 6);
  });
});
