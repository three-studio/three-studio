import {
  createColliderShape,
  createComponent,
  createComponentForEntity,
  createMeshEntity,
  originAboveFeet,
  type ColliderShape,
  type CombineRule,
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

describe('a collider’s material', () => {
  it('holds a box on a 30° slope by Maximum, and slides it by Minimum', async () => {
    const slope = ground(30);
    colliderOf(slope).material = { ...colliderOf(slope).material, friction: 0.2 };
    const boxWith = (frictionCombine: CombineRule, z: number) => {
      const box = withBody('box', [0, 1, z], { lockRotation: [true, true, true] });
      colliderOf(box).material = { ...colliderOf(box).material, friction: 1, frictionCombine };
      return box;
    };
    // tan 30° is 0.58: 1 grips, 0.2 does not.
    const held = boxWith('max', 1.5);
    const slid = boxWith('min', -1.5);
    const rig = await physicsRig([slope, held, slid]);

    rig.run(0.5);
    const landed = {
      held: rig.solved(held.entity.id).position,
      slid: rig.solved(slid.entity.id).position,
    };
    rig.run(1);

    expect(rig.solved(held.entity.id).position.distanceTo(landed.held)).toBeLessThan(0.01);
    expect(rig.solved(slid.entity.id).position.distanceTo(landed.slid)).toBeGreaterThan(0.5);
  });

  it('bounces a ball off a floor with no bounce by Maximum, and not by Minimum', async () => {
    const peakAfterLanding = async (restitutionCombine: CombineRule): Promise<number> => {
      const ball = withBody('sphere', [0, 2.5, 0]);
      const { material } = colliderOf(ball);
      colliderOf(ball).material = { ...material, restitution: 1, restitutionCombine };
      const rig = await physicsRig([ground(), ball]);
      const heights: number[] = [];
      for (let tick = 0; tick < 100; tick++) {
        rig.run(1 / 60);
        heights.push(rig.solved(ball.entity.id).position.y);
      }
      // Its first contact is the lowest it gets before it rises again, if it does.
      const contact = heights.findIndex((height, i) => i > 0 && height >= (heights[i - 1] ?? height));
      return Math.max(...heights.slice(contact === -1 ? heights.length - 1 : contact));
    };

    expect(await peakAfterLanding('max')).toBeGreaterThan(2);
    expect(await peakAfterLanding('min')).toBeLessThan(0.6);
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

describe('a mesh collider from its triangles', () => {
  it('is built as its hull on a dynamic body: a ball rests over its hole, and the engine says why', async () => {
    const torus = withBody('torus', [0, 0.15, 0]);
    torus.entity.transform.rotation = [-Math.PI / 2, 0, 0];
    colliderOf(torus).shape = { kind: 'mesh', build: 'triangles' };
    const ball = withBody('sphere', [0, 1, 0]);
    ball.entity.transform.scale = [0.2, 0.2, 0.2];
    const rig = await physicsRig([ground(), torus, ball]);

    rig.run(2);

    // The hull's top is at 0.3, so the ball rests about 0.4 up.
    expect(rig.solved(ball.entity.id).position.y).toBeGreaterThan(0.3);
    const said = rig.engine.warnings.filter((line) => line.includes('"Torus"'));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('Convex parts');
  });

  it('keeps its triangles and its hole on a fixed body', async () => {
    const torus = withBody('torus', [0, 0.15, 0], { bodyType: 'fixed' });
    torus.entity.transform.rotation = [-Math.PI / 2, 0, 0];
    colliderOf(torus).shape = { kind: 'mesh', build: 'triangles' };
    const ball = withBody('sphere', [0, 1, 0]);
    ball.entity.transform.scale = [0.2, 0.2, 0.2];
    const rig = await physicsRig([ground(), torus, ball]);

    rig.run(2);

    expect(Math.abs(rig.solved(ball.entity.id).position.y - 0.1)).toBeLessThan(0.02);
    expect(rig.engine.warnings.filter((line) => line.includes('"Torus"'))).toEqual([]);
  });
});

describe('a mesh collider in convex parts', () => {
  it('keeps a dynamic torus’s hole: a ball drops through it to the ground', async () => {
    const torus = withBody('torus', [0, 0.15, 0]);
    torus.entity.transform.rotation = [-Math.PI / 2, 0, 0];
    colliderOf(torus).shape = { kind: 'mesh', build: 'parts' };
    const ball = withBody('sphere', [0, 1, 0]);
    ball.entity.transform.scale = [0.2, 0.2, 0.2];
    const rig = await physicsRig([ground(), torus, ball]);

    rig.run(2);

    expect(Math.abs(rig.solved(ball.entity.id).position.y - 0.1)).toBeLessThan(0.02);
    expect(Math.abs(rig.solved(torus.entity.id).position.y - 0.15)).toBeLessThan(0.02);
  });
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
