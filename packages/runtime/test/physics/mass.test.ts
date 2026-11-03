import { createComponent, createEntity } from '@three-studio/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ground, physicsRig, standInForTheBrowser, takeTheBrowserBack, withBody } from './rig';

/*
 * A body weighs what its Rigid Body says, whatever its colliders are shaped
 * like, and falls even with nothing on it to weigh.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

describe('a body’s mass', () => {
  it('is its Rigid Body’s, whatever its collider', async () => {
    // The icosahedron's collider is its hull.
    const kinds = ['sphere', 'box', 'cylinder', 'icosahedron'] as const;
    const bodies = kinds.map((kind, i) => withBody(kind, [3 * i, 3, 0], { mass: 12 }));
    const rig = await physicsRig(bodies);

    for (const body of bodies) {
      expect(rig.engine.physics?.body(body.entity.id)?.mass).toBeCloseTo(12, 4);
    }
  });

  it('is a dynamic plane’s too, whose hull has no volume, and the plane lands', async () => {
    const plane = withBody('plane', [0, 3, 0], { mass: 5 });
    const rig = await physicsRig([ground(), plane]);

    expect(rig.engine.physics?.body(plane.entity.id)?.mass).toBeCloseTo(5, 4);
    rig.run(2);

    expect(Math.abs(rig.solved(plane.entity.id).position.y)).toBeLessThan(0.05);
  });

  it('makes a Rigid Body with nothing to weigh fall all the same', async () => {
    const empty = createEntity('Empty', [createComponent('rigidbody')]);
    empty.entity.transform.position = [0, 3, 0];
    const rig = await physicsRig([empty]);

    rig.run(1);

    expect(rig.solved(empty.entity.id).position.y).toBeLessThan(-1);
  });
});
