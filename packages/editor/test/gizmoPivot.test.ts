import { Box3, Euler, Object3D, Quaternion, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { pivotPose } from '../src/viewport/GizmoController';

/*
 * The gizmo drives a synthetic pivot, and for a long time that pivot had a
 * position and no orientation at all — it was reset to identity on every frame
 * that was not a drag.
 *
 * `TransformControls` points its handles with the world quaternion of whatever
 * it is attached to, so an identity pivot meant world-aligned handles always:
 * a rotation gizmo that turned with the gesture and snapped flat on release, a
 * Global/Local button with no effect in any mode, and a one-axis scale on a
 * rotated object that scaled along a world axis. One omission, three symptoms.
 */

/** An object a quarter turn about Y, which is the case that shows everything. */
function turned(): Object3D {
  const object = new Object3D();
  object.position.set(1, 2, 3);
  object.quaternion.setFromEuler(new Euler(0, Math.PI / 2, 0));
  object.updateMatrixWorld(true);
  return object;
}

/**
 * A child turned about X, under a parent turned about Y.
 *
 * Both turns are needed: with an unturned child, Local and Parent agree and the
 * test would pass on either answer.
 */
function nested(): { parent: Object3D; child: Object3D } {
  const parent = new Object3D();
  parent.quaternion.setFromEuler(new Euler(0, Math.PI / 2, 0));

  const child = new Object3D();
  child.quaternion.setFromEuler(new Euler(Math.PI / 4, 0, 0));

  parent.add(child);
  parent.updateMatrixWorld(true);
  return { parent, child };
}

const angles = (q: Quaternion): number[] => {
  const euler = new Euler().setFromQuaternion(q);
  return [euler.x, euler.y, euler.z].map((value) => Number(value.toFixed(6)));
};

describe('which way the handles point', () => {
  it('takes the object’s own orientation in Local', () => {
    const primary = turned();
    const { quaternion } = pivotPose({
      mode: 'rotate',
      space: 'local',
      pivotMode: 'pivot',
      bounds: null,
      primary,
    });
    expect(angles(quaternion)).toEqual(angles(primary.quaternion));
  });

  it('stays on the world axes in Global', () => {
    const { quaternion } = pivotPose({
      mode: 'rotate',
      space: 'world',
      pivotMode: 'pivot',
      bounds: null,
      primary: turned(),
    });
    expect(angles(quaternion)).toEqual([0, 0, 0]);
  });

  it('takes the parent’s orientation in Auto, not the object’s own', () => {
    const { parent, child } = nested();
    const { quaternion } = pivotPose({
      mode: 'rotate',
      space: 'parent',
      pivotMode: 'pivot',
      bounds: null,
      primary: child,
    });
    expect(angles(quaternion)).toEqual(angles(parent.getWorldQuaternion(new Quaternion())));
    expect(angles(quaternion)).not.toEqual(angles(child.getWorldQuaternion(new Quaternion())));
  });

  it('degenerates to the world axes in Auto at the root, with no branch for it', () => {
    // The real graph: `SceneBinder` hangs a root entity from a `Group` it never
    // gives a transform to, so reading the parent there yields the identity.
    const root = new Object3D();
    const primary = turned();
    root.add(primary);
    root.updateMatrixWorld(true);

    const { quaternion } = pivotPose({
      mode: 'rotate',
      space: 'parent',
      pivotMode: 'pivot',
      bounds: null,
      primary,
    });
    expect(angles(quaternion)).toEqual([0, 0, 0]);
  });

  it('orients scale to the object whatever the button says', () => {
    // Not a preference: three forces local space for scale, and a scale about
    // world axes applied to a rotated object is a shear that `decompose` drops.
    const primary = turned();
    for (const space of ['world', 'local', 'parent'] as const) {
      const { quaternion } = pivotPose({
        mode: 'scale',
        space,
        pivotMode: 'pivot',
        bounds: null,
        primary,
      });
      expect(angles(quaternion)).toEqual(angles(primary.quaternion));
    }
  });

  it('has nothing to point at when the selection resolves to nothing', () => {
    const { position, quaternion } = pivotPose({
      mode: 'rotate',
      space: 'local',
      pivotMode: 'pivot',
      bounds: null,
      primary: undefined,
    });
    expect(position.toArray()).toEqual([0, 0, 0]);
    expect(angles(quaternion)).toEqual([0, 0, 0]);
  });
});

describe('where the pivot sits', () => {
  it('sits on the active object in Pivot mode', () => {
    const { position } = pivotPose({
      mode: 'translate',
      space: 'world',
      pivotMode: 'pivot',
      bounds: new Box3(new Vector3(-10, -10, -10), new Vector3(10, 10, 10)),
      primary: turned(),
    });
    expect(position.toArray()).toEqual([1, 2, 3]);
  });

  it('sits on the centre of the selection in Center mode, still turned with the active object', () => {
    const primary = turned();
    const { position, quaternion } = pivotPose({
      mode: 'rotate',
      space: 'local',
      pivotMode: 'center',
      bounds: new Box3(new Vector3(0, 0, 0), new Vector3(4, 8, 12)),
      primary,
    });
    // A group has no orientation of its own to offer, so the active object
    // lends its own — as in Unity.
    expect(position.toArray()).toEqual([2, 4, 6]);
    expect(angles(quaternion)).toEqual(angles(primary.quaternion));
  });

  it('falls back to the active object when Center mode has no bounds to measure', () => {
    const { position } = pivotPose({
      mode: 'translate',
      space: 'world',
      pivotMode: 'center',
      bounds: null,
      primary: turned(),
    });
    expect(position.toArray()).toEqual([1, 2, 3]);
  });
});
