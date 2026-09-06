import { createEntity, createTransform, type EntityTemplate } from '@three-studio/core';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { close, sceneWith } from '../../core/test/fixtures';
import { localTransformAfterDelta, worldMatrix, worldPosition } from '../src/commands/transformSpace';

/*
 * The multi-object gizmo drives a synthetic pivot, so there is no bound object to
 * read a result back from: the gesture produces a world-space delta and each
 * target's new pose is computed from it. That is a change of nature rather than an
 * extension — hence these, written before anything was wired to them.
 */

const translate = (x: number, y: number, z: number) => new Matrix4().makeTranslation(x, y, z);

/** A rotation about the world Y axis, through a pivot rather than the origin. */
function rotateAbout(pivot: Vector3, radians: number): Matrix4 {
  const spin = new Matrix4().makeRotationFromQuaternion(
    new Quaternion().setFromEuler(new Euler(0, radians, 0)),
  );
  return translate(pivot.x, pivot.y, pivot.z)
    .multiply(spin)
    .multiply(translate(-pivot.x, -pivot.y, -pivot.z));
}

/**
 * A scale about a pivot that carries an orientation, which is what the gizmo
 * now produces: `T · R · S · R⁻¹ · T⁻¹`.
 *
 * With `basis` at identity this is the world-axis scale the gizmo used to send,
 * and the test below is the difference between the two.
 */
function scaleAbout(pivot: Vector3, basis: Quaternion, factors: Vector3): Matrix4 {
  const rotation = new Matrix4().makeRotationFromQuaternion(basis);
  return translate(pivot.x, pivot.y, pivot.z)
    .multiply(rotation)
    .multiply(new Matrix4().makeScale(factors.x, factors.y, factors.z))
    .multiply(rotation.clone().invert())
    .multiply(translate(-pivot.x, -pivot.y, -pivot.z));
}

describe('moving an entity by a world delta', () => {
  it('adds the delta to a root entity', () => {
    const cube = createEntity('Cube');
    cube.entity.transform = { ...createTransform(), position: [1, 2, 3] };
    const scene = sceneWith([cube]);

    const moved = localTransformAfterDelta(scene, cube.entity.id, translate(10, 0, -5));
    close(moved.position, [11, 2, -2]);
  });

  it("expresses the delta in the parent's terms, not the world's", () => {
    const parent = createEntity('Parent');
    // Rotated a quarter turn about Y, so the child's local +X points at world -Z.
    parent.entity.transform = { position: [0, 0, 0], rotation: [0, Math.PI / 2, 0], scale: [1, 1, 1] };
    const child = createEntity('Child');
    child.entity.parent = parent.entity.id;
    parent.entity.children = [child.entity.id];
    child.entity.transform = { ...createTransform(), position: [0, 0, 0] };

    const scene = sceneWith([parent, child]);
    const moved = localTransformAfterDelta(scene, child.entity.id, translate(0, 0, -4));

    // Four units along world -Z is four along the parent's local +X.
    close(moved.position, [4, 0, 0]);
  });

  it("rotates around the pivot, not around each object's own origin", () => {
    const a = createEntity('A');
    a.entity.transform = { ...createTransform(), position: [2, 0, 0] };
    const b = createEntity('B');
    b.entity.transform = { ...createTransform(), position: [-2, 0, 0] };
    const scene = sceneWith([a, b]);

    // Half a turn about the midpoint: the two swap places. Rotating each about
    // its own origin would leave both exactly where they are.
    const delta = rotateAbout(new Vector3(0, 0, 0), Math.PI);
    close(localTransformAfterDelta(scene, a.entity.id, delta).position, [-2, 0, 0]);
    close(localTransformAfterDelta(scene, b.entity.id, delta).position, [2, 0, 0]);
  });

  it('matches what an equivalent single-object move would give', () => {
    const cubes: EntityTemplate[] = [0, 1, 2].map((i) => {
      const cube = createEntity(`Cube ${i}`);
      cube.entity.transform = { ...createTransform(), position: [i * 2, 1, 0] };
      return cube;
    });
    const scene = sceneWith(cubes);
    const delta = translate(0, 3, 0);

    // The property the sheet asks for: a delta applied to three objects gives
    // the same positions as three equivalent single moves.
    for (const cube of cubes) {
      const before = worldPosition(scene, cube.entity.id);
      const after = localTransformAfterDelta(scene, cube.entity.id, delta);
      close(after.position, [before[0], before[1] + 3, before[2]]);
    }
  });

  it('scales a turned object along its own axes, not the world’s', () => {
    // A quarter turn about Y, so the object's own +X points at world -Z.
    const cube = createEntity('Cube');
    cube.entity.transform = { position: [0, 0, 0], rotation: [0, Math.PI / 2, 0], scale: [1, 1, 1] };
    const scene = sceneWith([cube]);
    const basis = new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0));

    // Doubling along the object's own X is what dragging its red handle means.
    const scaled = localTransformAfterDelta(
      scene,
      cube.entity.id,
      scaleAbout(new Vector3(0, 0, 0), basis, new Vector3(2, 1, 1)),
    );
    close(scaled.scale, [2, 1, 1]);
    close(scaled.rotation, [0, Math.PI / 2, 0]);

    // What the gizmo sent before the pivot had an orientation: the same drag,
    // about the *world* X. At a quarter turn the axes still line up, so the
    // result is representable — and wrong: it is the object's Z that doubles.
    const worldAxis = localTransformAfterDelta(
      scene,
      cube.entity.id,
      scaleAbout(new Vector3(0, 0, 0), new Quaternion(), new Vector3(2, 1, 1)),
    );
    expect(worldAxis.scale[0]).toBeCloseTo(1, 5);
    expect(worldAxis.scale[2]).toBeCloseTo(2, 5);
  });

  it('cannot even express a world-axis scale on an object turned off the axes', () => {
    // An eighth of a turn, where the axes no longer line up at all. A non-uniform
    // scale about the world axes then leaves a matrix with shear in it, and
    // position/rotation/scale has nowhere to put shear — `decompose` drops it
    // without a word, so the object silently ends up a shape nobody asked for.
    const cube = createEntity('Cube');
    cube.entity.transform = { position: [0, 0, 0], rotation: [0, Math.PI / 4, 0], scale: [1, 1, 1] };
    const scene = sceneWith([cube]);

    const delta = scaleAbout(new Vector3(0, 0, 0), new Quaternion(), new Vector3(2, 1, 1));
    const pose = localTransformAfterDelta(scene, cube.entity.id, delta);

    const asked = delta.clone().multiply(worldMatrix(scene, cube.entity.id));
    const got = new Matrix4().compose(
      new Vector3().fromArray(pose.position),
      new Quaternion().setFromEuler(new Euler().fromArray(pose.rotation)),
      new Vector3().fromArray(pose.scale),
    );
    expect(got.elements.map((n) => Number(n.toFixed(4)))).not.toEqual(
      asked.elements.map((n) => Number(n.toFixed(4))),
    );

    // Through an oriented pivot there is no shear to lose, and it round-trips.
    const basis = new Quaternion().setFromEuler(new Euler(0, Math.PI / 4, 0));
    const clean = localTransformAfterDelta(
      scene,
      cube.entity.id,
      scaleAbout(new Vector3(0, 0, 0), basis, new Vector3(2, 1, 1)),
    );
    close(clean.scale, [2, 1, 1]);
    close(clean.rotation, [0, Math.PI / 4, 0]);
  });

  it('leaves an entity alone when the delta is the identity', () => {
    const cube = createEntity('Cube');
    cube.entity.transform = { position: [1, 2, 3], rotation: [0.2, 0.3, 0.4], scale: [2, 2, 2] };
    const scene = sceneWith([cube]);

    const same = localTransformAfterDelta(scene, cube.entity.id, new Matrix4());
    close(same.position, [1, 2, 3]);
    close(same.rotation, [0.2, 0.3, 0.4]);
    close(same.scale, [2, 2, 2]);
  });
});
