import { createComponent, createEntity } from '@three-studio/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  block,
  ground,
  nest,
  physicsRig,
  player,
  standInForTheBrowser,
  takeTheBrowserBack,
  withCollider,
} from './rig';

/*
 * What the engine says of a set-up that will not behave as its author expects,
 * read over the bodies the world builds, so that the two cannot disagree.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

describe('the physics set-up', () => {
  it('says nothing of a Rigid Body whose colliders are on its children', async () => {
    const cart = createEntity('Cart', [createComponent('rigidbody')]);
    const wheel = withCollider('sphere', [0.5, 0, 0]);
    nest(cart, wheel);
    const rig = await physicsRig([ground(), cart, wheel]);

    expect(rig.engine.warnings.filter((line) => line.includes('"Cart"'))).toEqual([]);
  });

  it('says where a Collider may go for a Rigid Body with none anywhere', async () => {
    const rig = await physicsRig([ground(), createEntity('Cart', [createComponent('rigidbody')])]);

    expect(rig.engine.warnings).toContain(
      '"Cart" has a Rigid Body but no Collider, on it or on a child without a body of its own, so nothing can touch it. Add a Collider.',
    );
  });

  it('warns once about a player without a Collider', async () => {
    const walker = player([0, 1, 0]);
    walker.components = walker.components.filter((component) => component.type !== 'collider');
    const rig = await physicsRig([ground(), walker]);

    expect(rig.engine.warnings.filter((line) => line.includes('"Player"'))).toHaveLength(1);
  });

  it('counts no collider riding the player as ground', async () => {
    const walker = player([0, 1, 0]);
    const held = block([0, 0, -0.6], [0.4, 0.4, 0.4]);
    nest(walker, held);
    const rig = await physicsRig([walker, held]);

    expect(rig.engine.warnings).toContain(
      'Nothing but the player has a Collider, so there is no ground to stand on. Add a Collider to whatever the player should walk on.',
    );
  });
});
