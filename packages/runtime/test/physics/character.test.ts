import { Vector3 } from 'three/webgpu';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  block,
  ground,
  physicsRig,
  player,
  standInForTheBrowser,
  takeTheBrowserBack,
  withBody,
} from './rig';

/*
 * A character is a tool the world lends a behaviour: it moves its body by the
 * caller's numbers, and the world writes that body to its entity as it writes
 * every other.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

describe('a character', () => {
  it('pushes a ball it walks into, and both are drawn where their bodies are', async () => {
    const ball = withBody('sphere', [0, 0.5, -2], { interpolate: false });
    const walker = player([0, 1, 0]);
    const rig = await physicsRig([ground(), ball, walker]);

    rig.run(0.5);
    rig.press('KeyW');
    rig.run(1.5);

    const drawn = rig.drawn(ball.entity.id);
    expect(drawn.position.z).toBeLessThan(-3);
    expect(drawn.quaternion.angleTo(rig.solved(ball.entity.id).quaternion)).toBeLessThan(1e-4);
    // Stopped: a character is drawn between its last two ticks, up to one
    // behind its body while it walks. Not quite still even then: after a walk
    // it sits inside its skin, and Rapier's controller nudges it back out by a
    // tenth of a millimetre a tick.
    rig.release('KeyW');
    rig.run(0.5);
    const at = rig.drawn(walker.entity.id).position;
    expect(at.distanceTo(rig.solved(walker.entity.id).position)).toBeLessThan(1e-3);
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

  it('climbs a step its step height clears, and no higher', async () => {
    // A 0.5 m step, its face a metre ahead of the player. The world used to
    // climb 0.4 m for every character, whatever its level was built around.
    async function walkAt(stepHeight: number) {
      const walker = player([0, 1, 0], { controller: { stepHeight } });
      const rig = await physicsRig([ground(), block([0, 0.25, -6], [2, 0.25, 5]), walker]);
      rig.run(0.5);
      const settled = rig.drawn(walker.entity.id).position;
      rig.press('KeyW');
      rig.run(1);
      return { settled, walked: rig.drawn(walker.entity.id).position };
    }

    const over = await walkAt(0.6);
    expect(over.walked.y - over.settled.y).toBeGreaterThan(0.4);

    const under = await walkAt(0.3);
    expect(under.walked.z).toBeGreaterThan(-1);
    expect(under.walked.y).toBeCloseTo(under.settled.y, 1);
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
