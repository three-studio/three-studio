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

  it('a nested body is drawn where its body is, whichever the table lists first', async () => {
    const parent = withBody('box', [0, 3, 0]);
    parent.entity.transform.rotation = [0, 0, Math.PI / 6];
    const child = withBody('sphere', [3, 2, 0]);
    child.entity.parent = parent.entity.id;
    parent.entity.children = [child.entity.id];
    // The child first on purpose: written before its parent, it was placed
    // against the pose its parent was about to leave, one frame of the fall off
    // its body.
    const rig = await physicsRig([child, parent]);

    rig.run(0.5);

    for (const { entity } of [parent, child]) {
      const drawn = rig.drawn(entity.id);
      const solved = rig.solved(entity.id);
      expect(drawn.position.distanceTo(solved.position)).toBeLessThan(1e-5);
      expect(drawn.quaternion.angleTo(solved.quaternion)).toBeLessThan(1e-4);
    }
  });
});
