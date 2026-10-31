import { Quaternion } from 'three/webgpu';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ground, physicsRig, standInForTheBrowser, takeTheBrowserBack, withBody } from './rig';

/*
 * A body is drawn where the solver holds it, turned as the solver turns it.
 *
 * A ball rolling down a slope was drawn sliding: every body the solver turned
 * was drawn at the identity from its first frame, while its body rolled.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

describe('a body is drawn as the solver holds it', () => {
  it('a ball rolling down a slope is drawn turned as its body turns', async () => {
    const ball = withBody('sphere', [0, 1, 0]);
    const rig = await physicsRig([ground(15), ball]);

    rig.run(1);

    const drawn = rig.drawn(ball.entity.id).quaternion;
    expect(drawn.angleTo(rig.solved(ball.entity.id).quaternion)).toBeLessThan(1e-4);
    // Rolled, not slid: the identity is where it used to be drawn.
    expect(drawn.angleTo(new Quaternion())).toBeGreaterThan(1);
  });
});
