import {
  createComponent,
  createDefaultLayer,
  createEntity,
  createPhysicsSettings,
  createRenderingSettings,
  type CollisionLayer,
} from '@three-studio/core';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { sceneWith } from '../../../core/test/fixtures';
import { Engine } from '../../src/Engine';
import { NULL_ASSET_RESOLVER } from '../../src/assets/AssetResolver';
import {
  block,
  ground,
  nest,
  onLayer,
  physicsRig,
  player,
  standInForTheBrowser,
  takeTheBrowserBack,
  withBody,
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

/** A Player layer that passes through Default, the ground's. */
const APART: CollisionLayer[] = [createDefaultLayer(), { id: 'player', name: 'Player', ignores: ['default'] }];

describe('the physics set-up, with layers', () => {
  it('a collider on a layer the project no longer has collides as Default, and is warned about once', async () => {
    const lost = onLayer(withBody('sphere', [0, 2, 0]), 'gone');
    lost.entity.name = 'Lost';
    const rig = await physicsRig([ground(), lost]);

    rig.run(2);

    expect(Math.abs(rig.solved(lost.entity.id).position.y - 0.5)).toBeLessThan(0.02);
    const said = rig.engine.warnings.filter((line) => line.includes('"Lost"'));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('Default');
  });

  it('a player whose layer touches no other collider’s is told it will fall', async () => {
    const parted = await physicsRig([onLayer(player([0, 1, 0]), 'player'), ground()], { layers: APART });
    const said = parted.engine.warnings.filter((line) => line.includes('"Player"'));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('the layer "Player"');

    const touching = APART.map((layer) => ({ ...layer, ignores: [] }));
    const ticked = await physicsRig([onLayer(player([0, 1, 0]), 'player'), ground()], { layers: touching });
    expect(ticked.engine.warnings.filter((line) => line.includes('"Player"'))).toEqual([]);
  });

  it('says nothing of layers with physics off', async () => {
    const lost = onLayer(withBody('sphere', [0, 2, 0]), 'gone');
    const engine = await Engine.create({
      scene: sceneWith([onLayer(player([0, 1, 0]), 'player'), ground(), lost]),
      resolver: NULL_ASSET_RESOLVER,
      rendering: createRenderingSettings(),
      physicsSettings: { ...createPhysicsSettings(), layers: APART },
      domElement: new EventTarget() as unknown as HTMLElement,
      enablePhysics: false,
    });
    onTestFinished(() => engine.dispose());

    expect(engine.warnings.filter((line) => line.includes('layer'))).toEqual([]);
  });
});
