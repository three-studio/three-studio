import { createDefaultLayer, type CollisionLayer } from '@three-studio/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collisionGroups } from '../../src/physics/layers';
import {
  ground,
  onLayer,
  physicsRig,
  standInForTheBrowser,
  takeTheBrowserBack,
  withBody,
} from './rig';

/*
 * Every collider carries its layer as Rapier's collision groups, so a pair
 * whose layers do not touch is neither a contact nor an overlap.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

/** A parts from B. */
const parted: CollisionLayer[] = [
  createDefaultLayer(),
  { id: 'a', name: 'A', ignores: ['b'] },
  { id: 'b', name: 'B', ignores: [] },
];

describe('the groups a layer is built with', () => {
  it('gives Default alone its bit, touching itself', () => {
    expect(collisionGroups([createDefaultLayer()])('default')).toBe(0x0001_0001);
  });

  it('leaves out of each side the bit of a layer it does not touch', () => {
    const groupsOf = collisionGroups(parted);
    // Default, A and B are bits 0, 1 and 2, membership above and filter below.
    expect(groupsOf('a')).toBe(0x0002_0003);
    expect(groupsOf('b')).toBe(0x0004_0005);
    expect(groupsOf('default')).toBe(0x0001_0007);
  });

  it("gives an id the table does not hold Default's groups", () => {
    const groupsOf = collisionGroups(parted);
    expect(groupsOf('gone')).toBe(groupsOf('default'));
  });

  it("keeps the sixteenth layer's groups positive, its bit the 32nd", () => {
    const sixteen = [
      createDefaultLayer(),
      ...Array.from({ length: 15 }, (_, i): CollisionLayer => ({ id: `l${i + 1}`, name: `L${i + 1}`, ignores: [] })),
    ];
    expect(collisionGroups(sixteen)('l15')).toBe(0x8000_ffff);
  });
});

describe('colliders whose layers do not touch', () => {
  it("a ball on a layer that ignores a box's falls through it", async () => {
    const box = onLayer(withBody('box', [0, 0.5, 0], { lockRotation: [true, true, true] }), 'a');
    const ball = onLayer(withBody('sphere', [0, 3, 0]), 'b');
    const rig = await physicsRig([ground(), box, ball], { layers: parted });

    rig.run(3);

    expect(Math.abs(rig.solved(ball.entity.id).position.y - 0.5)).toBeLessThan(0.02);
  });

  it("a ball on the box's own layer lands on it", async () => {
    const box = onLayer(withBody('box', [0, 0.5, 0], { lockRotation: [true, true, true] }), 'a');
    const ball = onLayer(withBody('sphere', [0, 3, 0]), 'a');
    const rig = await physicsRig([ground(), box, ball], { layers: parted });

    rig.run(3);

    expect(Math.abs(rig.solved(ball.entity.id).position.y - 1.5)).toBeLessThan(0.02);
  });
});
