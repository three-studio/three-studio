import { createComponent } from '@three-studio/core';
import { Quaternion, Vector3 } from 'three/webgpu';
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
 * A body teleported is put at a pose at once, whatever drives it, its entity
 * with it, its velocities kept.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

describe('a teleported body', () => {
  it('is there at once, drawn there, and falls as fast', async () => {
    const ball = withBody('sphere', [0, 10, 0]);
    const rig = await physicsRig([ball]);
    const id = ball.entity.id;
    rig.run(0.5);

    const body = rig.body(id);
    const falling = body.linearVelocity.y;
    const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    body.teleport({ x: 5, y: 10, z: 0 }, turn);

    const there = new Vector3(5, 10, 0);
    expect(rig.solved(id).position.distanceTo(there)).toBeLessThan(1e-6);
    expect(rig.drawn(id).position.distanceTo(there)).toBeLessThan(1e-6);
    expect(rig.solved(id).quaternion.angleTo(turn)).toBeLessThan(1e-6);
    expect(body.linearVelocity.y).toBe(falling);

    // Half a tick, run by no tick: drawn where it was put, not sweeping in from x = 0.
    rig.run(1 / 120, 120);
    expect(Math.abs(rig.drawn(id).position.x - 5)).toBeLessThan(1e-6);

    rig.run(0.1);
    // From rest it would drop 5 cm. Keeping its half second of fall, about 54.
    expect(10 - rig.solved(id).position.y).toBeGreaterThan(0.4);
  });

  it('stays where it is put, Kinematic, and flings nothing', async () => {
    // Its entity left where it was, the next tick's follow pulled the platform
    // back at 600 m/s, through the crate resting on it.
    const platform = block([0, -0.25, 0], [8, 0.5, 8]);
    platform.components.push({ ...createComponent('rigidbody'), bodyType: 'kinematicPosition' });
    const crate = withBody('box', [0, 0.5, 0]);
    const rig = await physicsRig([platform, crate]);
    rig.run(1);

    rig.body(platform.entity.id).teleport({ x: 10, y: -0.25, z: 0 });
    rig.run(0.5);

    expect(Math.abs(rig.solved(platform.entity.id).position.x - 10)).toBeLessThan(1e-6);
    expect(Math.abs(rig.drawn(platform.entity.id).position.x - 10)).toBeLessThan(1e-6);
    // Left behind, the crate falls straight down.
    const { x, z } = rig.body(crate.entity.id).linearVelocity;
    expect(Math.hypot(x, z)).toBeLessThan(1e-3);
    expect(rig.solved(crate.entity.id).position.y).toBeLessThan(0);
  });

  it('is moved, not turned, when handed no rotation', async () => {
    const ball = withBody('sphere', [0, 0, 0], { gravityScale: 0, angularDamping: 0 });
    const rig = await physicsRig([ball]);
    const body = rig.body(ball.entity.id);
    body.angularVelocity = { x: 0, y: 3, z: 0 };
    rig.run(0.2);

    const turned = body.rotation;
    const spin = body.angularVelocity;
    body.teleport({ x: 2, y: 0, z: 0 });

    expect(rig.solved(ball.entity.id).position.distanceTo(new Vector3(2, 0, 0))).toBeLessThan(1e-6);
    expect(body.rotation).toEqual(turned);
    expect(body.angularVelocity).toEqual(spin);
    expect(Math.abs(spin.y - 3)).toBeLessThan(1e-4);
  });

  it('puts the player there, walking', async () => {
    const walker = player([0, 1, 0]);
    const rig = await physicsRig([ground(), walker]);
    const id = walker.entity.id;
    rig.run(0.5);
    const settled = rig.solved(id).position;
    rig.press('KeyW');
    rig.run(0.2);

    rig.body(id).teleport({ x: 5, y: settled.y, z: settled.z });
    rig.run(1 / 60);

    const { position } = rig.solved(id);
    expect(Math.abs(position.x - 5)).toBeLessThan(1e-3);
    expect(Math.abs(position.y - settled.y)).toBeLessThan(0.05);
  });

  it('ignores a place that is not a number, and a rotation with no direction', async () => {
    const ball = withBody('sphere', [0, 0, 0], { gravityScale: 0 });
    const rig = await physicsRig([ball]);
    const id = ball.entity.id;
    const solved = rig.solved(id);
    const drawn = rig.drawn(id);

    const body = rig.body(id);
    body.teleport({ x: NaN, y: 0, z: 0 });
    body.teleport({ x: 3, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 0 });
    body.teleport({ x: 3, y: 0, z: 0 }, { x: 0, y: Infinity, z: 0, w: 1 });

    expect(rig.solved(id).position.toArray()).toEqual(solved.position.toArray());
    expect(rig.solved(id).quaternion.toArray()).toEqual(solved.quaternion.toArray());
    expect(rig.drawn(id).position.toArray()).toEqual(drawn.position.toArray());
    expect(rig.drawn(id).quaternion.toArray()).toEqual(drawn.quaternion.toArray());
  });
});
