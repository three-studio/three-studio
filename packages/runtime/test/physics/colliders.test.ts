import {
  createColliderShape,
  createComponent,
  createComponentForEntity,
  createMeshEntity,
  originAboveFeet,
  type ColliderShape,
  type EntityTemplate,
  type Vec3,
} from '@three-studio/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  colliderOf,
  ground,
  physicsRig,
  standInForTheBrowser,
  takeTheBrowserBack,
  withBody,
} from './rig';

/*
 * A collider rests where what is drawn rests: the shape physics builds is the
 * one the author sees, at the entity's scale.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

describe('a scaled collider', () => {
  it('rests where its mesh does, a capsule scaled 1.5 × 1 × 1.5', async () => {
    // Drawn 2 m tall and 1.5 m wide. Its radius was scaled by the largest axis,
    // which made the capsule 3 m tall and held it half a metre up.
    const capsule = withBody('capsule', [0, 3, 0], { lockRotation: [true, true, true] });
    capsule.entity.transform.scale = [1.5, 1, 1.5];
    const rig = await physicsRig([ground(), capsule]);

    rig.run(2);

    expect(rig.solved(capsule.entity.id).position.y).toBeCloseTo(1, 2);
  });

  it('rests on its drawn bottom, a box scaled 2 × 0.5 × 1', async () => {
    const box = withBody('box', [0, 2, 0], { lockRotation: [true, true, true] });
    box.entity.transform.scale = [2, 0.5, 1];
    const rig = await physicsRig([ground(), box]);

    rig.run(2);

    expect(rig.solved(box.entity.id).position.y).toBeCloseTo(0.25, 2);
  });
});

describe('a rounded collider', () => {
  it('rests a rounded 1 m box at 0.5, its outside the size drawn', async () => {
    const box = withBody('box', [0, 2, 0], { lockRotation: [true, true, true] });
    const collider = colliderOf(box);
    if (collider.shape.kind !== 'box') throw new Error('not a box');
    collider.shape = { ...collider.shape, rounding: 0.1 };
    const rig = await physicsRig([ground(), box]);

    rig.run(2);

    expect(rig.solved(box.entity.id).position.y).toBeCloseTo(0.5, 2);
  });
});

describe('a cylinder and a cone', () => {
  it('rests a cylinder of height 1 at y = 0.5', async () => {
    // Locked, so the old capsule could not tip off its round end and hide the
    // half metre it stood on: the audit measured it resting at 1.0.
    const cylinder = withBody('cylinder', [0, 2, 0], { lockRotation: [true, true, true] });
    const rig = await physicsRig([ground(), cylinder]);

    rig.run(2);

    expect(rig.solved(cylinder.entity.id).position.y).toBeCloseTo(0.5, 2);
  });

  it('stands a cone on its base, its apex up, as three draws it', async () => {
    // Tilted, because upright a cone resting on its base and one resting on its
    // apex stand at the same height. Built apex down, it would rest on its tip,
    // 0.5 · cos 30° ≈ 0.433 up; apex up, on its rim.
    const cone = coneBody([0, 2, 0]);
    cone.entity.transform.rotation = [0, 0, Math.PI / 6];
    const rig = await physicsRig([ground(), cone]);

    rig.run(2);

    const rim = 0.5 * Math.cos(Math.PI / 6) + 0.5 * Math.sin(Math.PI / 6);
    expect(rig.solved(cone.entity.id).position.y).toBeCloseTo(rim, 2);
  });
});

describe('a collider off its entity’s centre, turned', () => {
  const center: Vec3 = [0.1, 0.4, -0.2];
  const rotation: Vec3 = [0.3, 0.5, 0.7];
  const shapes: ColliderShape[] = [
    { ...createColliderShape('box'), size: [0.6, 0.8, 0.4], center, rotation },
    { ...createColliderShape('sphere'), radius: 0.3, center },
    { ...createColliderShape('capsule'), radius: 0.2, height: 0.9, center, rotation },
    { ...createColliderShape('cylinder'), radius: 0.3, height: 0.6, center, rotation },
    { ...createColliderShape('cone'), radius: 0.3, height: 0.6, center, rotation },
    // Rounded too: the rounding is outside the core Rapier is handed.
    { ...createColliderShape('box'), size: [0.6, 0.8, 0.4], rounding: 0.05, center, rotation },
    { ...createColliderShape('cylinder'), radius: 0.3, height: 0.6, rounding: 0.05, center, rotation },
    { ...createColliderShape('cone'), radius: 0.3, height: 0.6, rounding: 0.05, center, rotation },
  ];

  // Core's Euler pinned to three's, which the builder turns through, and to
  // Rapier's: what `originAboveFeet` says is where the shape's bottom is.
  const named = shapes.map((shape) => {
    const rounded = 'rounding' in shape && shape.rounding > 0 ? 'rounded ' : '';
    return [`${rounded}${shape.kind}`, shape] as const;
  });

  it.each(named)(
    'rests a %s where originAboveFeet puts its bottom',
    async (_kind, shape) => {
      const body = withBody('box', [0, 2, 0], { lockRotation: [true, true, true] });
      colliderOf(body).shape = shape;
      const rig = await physicsRig([ground(), body]);

      rig.run(2);

      expect(rig.solved(body.entity.id).position.y).toBeCloseTo(originAboveFeet(shape), 2);
    },
  );
});

/**
 * A Cylinder mesh whose top radius is 0, with a dynamic body whose rotations are
 * locked and the collider Add Component guesses for it.
 */
function coneBody(position: Vec3): EntityTemplate {
  const template = createMeshEntity('cylinder');
  const mesh = template.components[0];
  if (mesh?.type !== 'mesh' || mesh.geometry.kind !== 'cylinder') throw new Error('not a cylinder');
  mesh.geometry = { ...mesh.geometry, radiusTop: 0 };
  template.components.push(
    { ...createComponent('rigidbody'), lockRotation: [true, true, true] },
    createComponentForEntity('collider', template.components),
  );
  template.entity.transform.position = position;
  return template;
}
