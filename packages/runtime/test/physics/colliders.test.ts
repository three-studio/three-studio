import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ground, physicsRig, standInForTheBrowser, takeTheBrowserBack, withBody } from './rig';

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
