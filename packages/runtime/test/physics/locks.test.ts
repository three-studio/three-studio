import { Quaternion, Vector3 } from 'three/webgpu';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ground, physicsRig, standInForTheBrowser, takeTheBrowserBack, withBody } from './rig';

/*
 * A dynamic body's position and rotation can each be locked per world axis:
 * the solver moves it along, and turns it about, only the axes left free.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

describe('a body with locked axes', () => {
  it('does not fall with its Y position locked', async () => {
    const ball = withBody('sphere', [0, 3, 0], { lockPosition: [false, true, false] });
    const rig = await physicsRig([ball]);

    rig.run(1);

    const { position } = rig.solved(ball.entity.id);
    expect(position.distanceTo(new Vector3(0, 3, 0))).toBeLessThan(1e-6);
  });

  it('slides down a steep slope without turning, its rotations locked', async () => {
    // Unlocked, the same ball rolls down it, as `pose.test.ts` shows.
    const ball = withBody('sphere', [0, 1, 0], { lockRotation: [true, true, true] });
    const rig = await physicsRig([ground(50), ball]);

    rig.run(0.25);
    const landed = rig.solved(ball.entity.id).position;
    rig.run(1);

    const { position, quaternion } = rig.solved(ball.entity.id);
    expect(quaternion.angleTo(new Quaternion())).toBeLessThan(1e-6);
    expect(position.distanceTo(landed)).toBeGreaterThan(1);
  });
});
