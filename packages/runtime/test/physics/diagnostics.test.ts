import {
  createDefaultLayer,
  createEntity,
  rigidbodyType,
  fixedId,
  type EntityTemplate,
  createPhysicsSettings,
  createRenderingSettings,
  type CollisionLayer,
} from '@three-studio/core';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { sceneWith } from '../../../core/test/fixtures';
import { World } from '../../src/world/World';
import { AssetCache } from '../../src/assets/AssetCache';
import { NULL_ASSET_RESOLVER } from '../../src/assets/AssetResolver';
import { builtInRegistries, withoutPhysics } from '../registries';
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
  withJoint,
} from './rig';
import { StudioTime } from '../../src/time/StudioTime';

/*
 * What the world says of a set-up that will not behave as its author expects,
 * read over the bodies the world builds, so that the two cannot disagree.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

describe('the physics set-up', () => {
  it('says nothing of a Rigid Body whose colliders are on its children', async () => {
    const cart = createEntity('Cart', [rigidbodyType.create()]);
    const wheel = withCollider('sphere', [0.5, 0, 0]);
    nest(cart, wheel);
    const rig = await physicsRig([ground(), cart, wheel]);

    expect(rig.world.warnings.filter((line) => line.includes('"Cart"'))).toEqual([]);
  });

  it('says where a Collider may go for a Rigid Body with none anywhere', async () => {
    const rig = await physicsRig([ground(), createEntity('Cart', [rigidbodyType.create()])]);

    expect(rig.world.warnings).toContain(
      '"Cart" has a Rigid Body but no Collider, on it or on a child without a body of its own, so nothing can touch it. Add a Collider.',
    );
  });

  it('warns once about a player without a Collider', async () => {
    const walker = player([0, 1, 0]);
    walker.components = walker.components.filter((component) => component.type !== 'collider');
    const rig = await physicsRig([ground(), walker]);

    expect(rig.world.warnings.filter((line) => line.includes('"Player"'))).toHaveLength(1);
  });

  it('counts no collider riding the player as ground', async () => {
    const walker = player([0, 1, 0]);
    const held = block([0, 0, -0.6], [0.4, 0.4, 0.4]);
    nest(walker, held);
    const rig = await physicsRig([walker, held]);

    expect(rig.world.warnings).toContain(
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
    const said = rig.world.warnings.filter((line) => line.includes('"Lost"'));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('Default');
  });

  it('a player whose layer touches no other collider’s is told it will fall', async () => {
    const parted = await physicsRig([onLayer(player([0, 1, 0]), 'player'), ground()], { layers: APART });
    const said = parted.world.warnings.filter((line) => line.includes('"Player"'));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('the layer "Player"');

    const touching = APART.map((layer) => ({ ...layer, ignores: [] }));
    const ticked = await physicsRig([onLayer(player([0, 1, 0]), 'player'), ground()], { layers: touching });
    expect(ticked.world.warnings.filter((line) => line.includes('"Player"'))).toEqual([]);
  });

  it('says nothing of layers with physics off', async () => {
    const lost = onLayer(withBody('sphere', [0, 2, 0]), 'gone');
    const registries = builtInRegistries();
    const world = await World.play({
      time: new StudioTime(),
      document: sceneWith([onLayer(player([0, 1, 0]), 'player'), ground(), lost]),
      registries: withoutPhysics(registries),
      assets: new AssetCache(registries, { resolver: NULL_ASSET_RESOLVER, idleBudgetBytes: 0 }),
      rendering: createRenderingSettings(),
      physicsSettings: { ...createPhysicsSettings(), layers: APART },
    });
    onTestFinished(() => world.dispose());

    // The word: with no element to drive it the player is not built, and the
    // world says it has no player controller, which holds "layer" too.
    expect(world.warnings.filter((line) => /\blayer\b/.test(line))).toEqual([]);
  });
});

describe('the physics set-up, with joints', () => {
  /** The one line naming the entity, which must say each of `words`. */
  async function saidOf(name: string, entities: readonly EntityTemplate[], ...words: string[]): Promise<void> {
    const rig = await physicsRig([ground(), ...entities]);
    const lines = rig.world.warnings.filter((line) => line.startsWith(`"${name}"`));
    expect(lines).toHaveLength(1);
    for (const word of words) expect(lines[0]).toContain(word);
  }

  const named = (template: EntityTemplate, name: string) => {
    template.entity.name = name;
    return template;
  };

  it('says so of a joint whose Connected Body is gone', async () => {
    const door = named(withJoint(withBody('box', [0, 1, 0]), { connectedEntity: fixedId('entity', 'gone') }), 'Door');
    await saidOf('Door', [door], 'Connected Body');
  });

  it('says so of a joint on an entity that moves with no body', async () => {
    await saidOf('Hinge', [withJoint(createEntity('Hinge'))], 'Rigid Body');
  });

  it('says so of a joint connected to an entity that moves with no body', async () => {
    const frame = createEntity('Frame');
    const door = named(withJoint(withBody('box', [0, 1, 0]), { connectedEntity: frame.entity.id }), 'Door');
    await saidOf('Door', [frame, door], '"Door"', '"Frame"');
  });

  it('says so of a joint on a child naming its parent', async () => {
    const door = named(withBody('box', [0, 1, 0]), 'Door');
    const handle = withJoint(createEntity('Handle'), { connectedEntity: door.entity.id });
    nest(door, handle);
    await saidOf('Handle', [door, handle], 'same body');
  });

  it('says so of a joint that holds no Dynamic body', async () => {
    const gate = named(withJoint(withBody('box', [0, 1, 0], { bodyType: 'kinematicPosition' })), 'Gate');
    await saidOf('Gate', [gate], 'Dynamic');
  });

  it('says nothing of a working door, nor anything with physics off', async () => {
    const frame = named(block([0, 1, 0], [0.1, 2, 0.1]), 'Frame');
    const door = named(
      withJoint(withBody('box', [0.55, 1, 0]), { connectedEntity: frame.entity.id, anchor: [-0.5, 0, 0] }),
      'Door',
    );
    const rig = await physicsRig([ground(), frame, door]);
    expect(rig.world.warnings.filter((line) => line.includes('Joint'))).toEqual([]);

    const registries = builtInRegistries();
    const world = await World.play({
      time: new StudioTime(),
      document: sceneWith([withJoint(createEntity('Hinge'))]),
      registries: withoutPhysics(registries),
      assets: new AssetCache(registries, { resolver: NULL_ASSET_RESOLVER, idleBudgetBytes: 0 }),
      rendering: createRenderingSettings(),
    });
    onTestFinished(() => world.dispose());
    expect(world.warnings.filter((line) => line.includes('Joint'))).toEqual([]);
  });
});
