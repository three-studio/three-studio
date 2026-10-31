import { Vector3 } from 'three/webgpu';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ground, physicsRig, player, standInForTheBrowser, takeTheBrowserBack, withBody } from './rig';

/*
 * A character is a tool the world lends a behaviour: it moves its body by the
 * caller's numbers, and the world writes that body to its entity as it writes
 * every other.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

describe('a character', () => {
  it('pushes a ball it walks into, and both are drawn where their bodies are', async () => {
    const ball = withBody('sphere', [0, 0.5, -2]);
    const walker = player([0, 1, 0]);
    const rig = await physicsRig([ground(), ball, walker]);

    rig.run(0.5);
    rig.press('KeyW');
    rig.run(1.5);

    const drawn = rig.drawn(ball.entity.id);
    expect(drawn.position.z).toBeLessThan(-3);
    expect(drawn.quaternion.angleTo(rig.solved(ball.entity.id).quaternion)).toBeLessThan(1e-4);
    const at = rig.drawn(walker.entity.id).position;
    expect(at.distanceTo(rig.solved(walker.entity.id).position)).toBeLessThan(1e-5);
  });

  it('walks on a dynamic body, and stays upright', async () => {
    // A Rigid Body added before the Player Controller kept its Dynamic type: the
    // solver drove the body, the character's targets moved nothing, and the
    // player stood still.
    const walker = player([0, 1, 0], { bodyType: 'dynamic' });
    const rig = await physicsRig([ground(), walker]);

    rig.run(0.5);
    const from = rig.drawn(walker.entity.id).position;
    rig.press('KeyW');
    rig.run(1);

    const { position, quaternion } = rig.drawn(walker.entity.id);
    expect(from.z - position.z).toBeGreaterThan(4);
    const up = new Vector3(0, 1, 0);
    expect(up.clone().applyQuaternion(quaternion).angleTo(up)).toBeLessThan((1 * Math.PI) / 180);
  });

  it('leaves no body in the world while it flies', async () => {
    // A ball dropped on a flying player's spawn landed on a capsule nobody could
    // see: the body stayed there, while the player flew elsewhere.
    const ball = withBody('sphere', [0, 3, 0]);
    const rig = await physicsRig([player([0, 1, 0], { controller: { mode: 'fly' } }), ball, ground()]);

    rig.run(2);

    const { position } = rig.drawn(ball.entity.id);
    expect(position.y).toBeCloseTo(0.5, 1);
    expect(Math.abs(position.x)).toBeLessThan(1e-3);
    expect(Math.abs(position.z)).toBeLessThan(1e-3);
  });
});
