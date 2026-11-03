import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ground,
  physicsRig,
  player,
  standInForTheBrowser,
  takeTheBrowserBack,
  withBody,
} from './rig';

/*
 * A body is drawn between its last two ticks.
 *
 * The step runs at the project's rate and the screen at its own. Drawn at its
 * last tick, a body stood still on every other frame of a 120 Hz display, and
 * so did the player's camera, which rides the player's body.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

describe('a body drawn between ticks', () => {
  it('a new ball, drawn at 120 Hz over a 60 Hz step, moves on every frame, between its last two ticks', async () => {
    const smooth = withBody('sphere', [0, 10, 0]);
    const stepped = withBody('sphere', [2, 10, 0], { interpolate: false });
    const rig = await physicsRig([smooth, stepped]);
    const height = (pose: { position: { y: number } }) => pose.position.y;

    rig.run(0.25);
    // The smooth ball's solved height after each tick: the last two bound what is drawn.
    const ticks = [height(rig.solved(smooth.entity.id))];
    let smoothWas = height(rig.drawn(smooth.entity.id));
    let steppedWas = height(rig.drawn(stepped.entity.id));

    for (let frame = 1; frame <= 30; frame++) {
      rig.run(1 / 120, 120);
      const solved = height(rig.solved(smooth.entity.id));
      if (solved !== ticks.at(-1)) ticks.push(solved);

      const drawn = height(rig.drawn(smooth.entity.id));
      expect(drawn).toBeLessThan(smoothWas);
      if (ticks.length > 1) {
        expect(drawn).toBeGreaterThanOrEqual(ticks.at(-1)! - 1e-6);
        expect(drawn).toBeLessThanOrEqual(ticks.at(-2)! + 1e-6);
      }
      smoothWas = drawn;

      // Drawn at its body, it moves on the frames that run a tick: every other one.
      const steppedNow = height(rig.drawn(stepped.entity.id));
      if (frame % 2 === 1) expect(steppedNow).toBe(steppedWas);
      else expect(steppedNow).toBeLessThan(steppedWas);
      steppedWas = steppedNow;
    }
  });

  it("never reads the world's own drawing as a script's write", async () => {
    // Were it to, the smooth ball would be put back where it is drawn, up to a
    // tick behind its body, on every frame, and fall behind the other.
    const smooth = withBody('sphere', [0, 10, 0]);
    const stepped = withBody('sphere', [2, 10, 0], { interpolate: false });
    const rig = await physicsRig([smooth, stepped]);

    rig.run(1, 120);

    const height = (id: string) => rig.solved(id).position.y;
    expect(Math.abs(height(smooth.entity.id) - height(stepped.entity.id))).toBeLessThan(1e-9);
  });

  it("moves the player's camera on every frame at 120 Hz", async () => {
    const walker = player([0, 1, 0]);
    const rig = await physicsRig([ground(), walker]);

    rig.run(0.5);
    rig.press('KeyW');
    // Up to speed first: a body at rest is drawn at rest, between ticks or not.
    rig.run(0.25);

    let was = rig.engine.activeCamera.position.clone();
    for (let frame = 0; frame < 30; frame++) {
      rig.run(1 / 120, 120);
      const now = rig.engine.activeCamera.position.clone();
      expect(now.distanceTo(was)).toBeGreaterThan(0);
      was = now;
    }
  });

  it('Step still moves a smooth body by one tick', async () => {
    const ball = withBody('sphere', [0, 10, 0]);
    const rig = await physicsRig([ball]);
    rig.run(0.25);
    // Half a tick into the next, as a pause at 120 Hz can leave it.
    rig.run(1 / 120, 120);
    const drawnBefore = rig.drawn(ball.entity.id).position.y;
    const solvedBefore = rig.solved(ball.entity.id).position.y;

    rig.engine.update(rig.engine.fixedStep);

    const drawn = rig.drawn(ball.entity.id).position.y;
    expect(drawn).toBeLessThan(drawnBefore);
    expect(drawn).toBeLessThanOrEqual(solvedBefore + 1e-6);
    expect(drawn).toBeGreaterThanOrEqual(rig.solved(ball.entity.id).position.y - 1e-6);
  });
});
