import {
  assertDefined,
  colliderType,
  createEntity,
  createJointMotion,
  createPhysicsSettings,
  createRenderingSettings,
  fixedId,
  modelType,
  rigidbodyType,
  type EntityId,
  type EntityTemplate,
} from '@three-studio/core';
import { BoxGeometry, Group, Mesh, type Object3D } from 'three/webgpu';
import { afterAll, afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';
import { sceneWith } from '../../../core/test/fixtures';
import { AssetCache } from '../../src/assets/AssetCache';
import type { Collision } from '../../src/physics/PhysicsApi';
import { physicsOf, physicsStats } from '../../src/physics/physicsOf';
import { Behaviour } from '../../src/scripting/ScriptHost';
import { StudioTime } from '../../src/time/StudioTime';
import { World } from '../../src/world/World';
import { builtInRegistries } from '../registries';
import {
  block,
  ground,
  nest,
  physicsRigOn,
  sensor,
  standInForTheBrowser,
  takeTheBrowserBack,
  withBody,
  withCollider,
  withJoint,
  withScript,
} from './rig';

/*
 * Physics is handed what the running game's document holds one component at a
 * time: a Rigid Body, a Collider or a Joint spawned, put, deleted or destroyed
 * while the game runs is built, or given back, at the world's next pass — and a
 * scene built at once is the scene built one entity per pass.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

afterEach(() => {
  vi.restoreAllMocks();
});

type Hook = 'onCollisionEnter' | 'onCollisionExit' | 'onTriggerEnter' | 'onTriggerExit';

/** What each entity's Ear heard in a world, in order, by entity id. */
const heardIn = new WeakMap<World, Map<string, [Hook, string][]>>();

// An Ear on every Collider, as `events.test.ts` has, in registries of this
// file's own.
const registries = builtInRegistries();
registries.behaviours.register({
  id: 'collider',
  create: ({ entity }, world) => {
    const record = (hook: Hook, other: string) => {
      const log = heardIn.get(world) ?? new Map<string, [Hook, string][]>();
      heardIn.set(world, log.set(entity.id, [...(log.get(entity.id) ?? []), [hook, other]]));
    };
    return {
      onCollisionEnter: ({ other }) => record('onCollisionEnter', other),
      onCollisionExit: (other) => record('onCollisionExit', other),
      onTriggerEnter: (other) => record('onTriggerEnter', other),
      onTriggerExit: (other) => record('onTriggerExit', other),
    };
  },
});
const physicsRig = physicsRigOn(registries);

/** What the entity's Ear heard in the world, in order; `undefined` when it heard nothing. */
const heard = (world: World, template: EntityTemplate) => heardIn.get(world)?.get(template.entity.id);

const STEP = 1 / 60;
const DOWN = { x: 0, y: -1, z: 0 };

const LOW = fixedId('entity', 'low');
const MIDDLE = fixedId('entity', 'middle');
const HIGH = fixedId('entity', 'high');
const CART = fixedId('entity', 'cart');
const SKID = fixedId('entity', 'skid');
const PENDULUM = fixedId('entity', 'pendulum');

/** The template under a fixed id, so that two worlds built from two copies of a scene name it alike. */
function named(template: EntityTemplate, entityId: EntityId): EntityTemplate {
  template.entity.id = entityId;
  return template;
}

/**
 * A stack of three boxes on the ground, a cart standing on a skid it carries
 * on a child entity, and a pendulum hinged to the world: made afresh at each
 * call, each entity with the one it hangs under.
 */
function contraption(): { readonly template: EntityTemplate; readonly parent: EntityId | null }[] {
  const pendulum = withJoint(named(withBody('box', [-3, 2, 0], { interpolate: false, linearDamping: 2 }), PENDULUM), {
    anchor: [-1, 0, 0],
    motion: { ...createJointMotion('hinge'), axis: [0, 0, 1] },
  });
  return [
    { template: named(ground(), fixedId('entity', 'ground')), parent: null },
    { template: named(withBody('box', [0, 0.5, 0], { interpolate: false }), LOW), parent: null },
    { template: named(withBody('box', [0, 1.5, 0], { interpolate: false }), MIDDLE), parent: null },
    { template: named(withBody('box', [0, 2.5, 0], { interpolate: false }), HIGH), parent: null },
    { template: named(withBody('box', [4, 1.5, 0], { interpolate: false }), CART), parent: null },
    { template: named(withCollider('box', [0, -1, 0]), SKID), parent: CART },
    { template: pendulum, parent: null },
  ];
}

describe('a scene built one entity per pass', () => {
  it('is the scene built at once: the same bodies, colliders and joint, moving the same', async () => {
    const parts = contraption();
    const byId = new Map(parts.map(({ template }) => [template.entity.id, template]));
    for (const { template, parent } of parts) {
      const above = parent === null ? undefined : byId.get(parent);
      if (above) nest(above, template);
    }
    const whole = await physicsRig(parts.map(({ template }) => template));

    const piecemeal = await physicsRig([]);
    for (const { template, parent } of contraption()) {
      piecemeal.world.spawn(template, parent);
      piecemeal.world.reconcile();
    }

    expect(physicsStats(piecemeal.world)).toEqual(physicsStats(whole.world));
    for (const entityId of [LOW, MIDDLE, HIGH, CART, PENDULUM]) {
      expect(Math.abs(piecemeal.body(entityId).mass - whole.body(entityId).mass)).toBeLessThan(1e-6);
    }
    whole.run(2);
    piecemeal.run(2);
    for (const entityId of [LOW, MIDDLE, HIGH, CART, PENDULUM]) {
      const built = whole.solved(entityId);
      const spawned = piecemeal.solved(entityId);
      expect(spawned.position.distanceTo(built.position)).toBeLessThan(1e-4);
      expect(spawned.quaternion.angleTo(built.quaternion)).toBeLessThan(1e-4);
    }
    // The skid rides the cart, and the cart stands on it.
    expect(physicsOf(piecemeal.world)?.body(SKID)).toBeNull();
    expect(Math.abs(piecemeal.solved(CART).position.y - 1.5)).toBeLessThan(0.01);
  });
});

describe('what a running game spawns, puts, deletes and destroys', () => {
  it('a box spawned while the game runs falls and lands, and its script hears it, as does the floor', async () => {
    const landings: string[] = [];
    class Lands extends Behaviour {
      override onCollisionEnter({ other }: Collision) {
        landings.push(other);
      }
    }
    const floor = ground();
    const box = withScript(withBody('box', [0, 2, 0], { interpolate: false }), Lands);
    const rig = await physicsRigOn(registries, { spawnable: [box] })([floor]);
    rig.run(0.5);

    expect(rig.world.spawn(box)).toBe(box.entity.id);
    rig.run(2);

    expect(Math.abs(rig.solved(box.entity.id).position.y - 0.5)).toBeLessThan(0.01);
    expect(landings).toEqual([floor.entity.id]);
    expect(heard(rig.world, floor)).toEqual([['onCollisionEnter', box.entity.id]]);
  });

  it('a collider spawned under a moving body rides it, the body keeping its speed and its mass', async () => {
    const ball = withBody('sphere', [0, 5, 0], { mass: 2, gravityScale: 0, interpolate: false });
    const rig = await physicsRig([ball]);
    rig.body(ball.entity.id).linearVelocity = { x: 2, y: 0, z: 0 };
    rig.run(0.5);

    // A metre-wide box 2 m above the ball's centre, on a child with no body of its own.
    const lid = withCollider('box', [0, 2, 0]);
    rig.world.spawn(lid, ball.entity.id);
    rig.world.reconcile();

    const body = rig.body(ball.entity.id);
    expect(Math.abs(body.linearVelocity.x - 2)).toBeLessThan(1e-6);
    // Its Rigid Body's mass, shared with the lid by volume rather than added to.
    expect(Math.abs(body.mass - 2)).toBeLessThan(1e-6);
    expect(physicsOf(rig.world)?.body(lid.entity.id)).toBeNull();

    rig.run(1);
    const { x } = rig.solved(ball.entity.id).position;
    expect(x).toBeGreaterThan(2.5);
    const hit = physicsOf(rig.world)?.raycast({ x, y: 20, z: 0 }, DOWN, 30);
    expect(hit?.entity).toBe(lid.entity.id);
    expect(Math.abs((hit?.point.y ?? 0) - 7.5)).toBeLessThan(1e-3);
  });

  it('a Rigid Body put over children carrying colliders takes them from their fixed bodies; deleted, they get theirs back', async () => {
    const frame = createEntity('Frame', []);
    frame.entity.transform.position = [0, 3, 0];
    const left = withCollider('box', [-1, 0, 0]);
    const right = withCollider('box', [1, 0, 0]);
    const rig = await physicsRig([nest(frame, left, right), left, right]);
    const physics = assertDefined(physicsOf(rig.world), 'the world’s physics');
    // Level geometry: a fixed body each.
    expect(physics.body(left.entity.id)).not.toBeNull();
    expect(physics.body(frame.entity.id)).toBeNull();

    const rigidbody = { ...rigidbodyType.create(), interpolate: false };
    rig.world.putComponent(frame.entity.id, rigidbody);
    rig.run(0.5);

    expect(physics.body(left.entity.id)).toBeNull();
    expect(physics.body(right.entity.id)).toBeNull();
    expect(physicsStats(rig.world)).toMatchObject({ bodies: 1, colliders: 2 });
    expect(rig.solved(frame.entity.id).position.y).toBeLessThan(2);
    expect(rig.drawn(left.entity.id).position.y).toBeLessThan(2);

    rig.world.deleteComponent(frame.entity.id, rigidbody.id);
    rig.world.reconcile();
    const stopped = rig.drawn(left.entity.id).position;
    rig.run(0.5);

    expect(physics.body(frame.entity.id)).toBeNull();
    expect(physicsStats(rig.world)).toMatchObject({ bodies: 2, colliders: 2 });
    expect(rig.solved(left.entity.id).position.distanceTo(stopped)).toBeLessThan(1e-6);
    expect(rig.drawn(left.entity.id).position.distanceTo(stopped)).toBeLessThan(1e-6);
  });

  it('a body destroyed inside a trigger is heard leaving it once, after the next tick', async () => {
    const zone = sensor([0, 0, 0], [4, 4, 4]);
    const ball = withBody('sphere', [0, 0, 0], { gravityScale: 0 });
    const rig = await physicsRig([zone, ball]);
    rig.run(0.2);
    expect(heard(rig.world, zone)).toEqual([['onTriggerEnter', ball.entity.id]]);

    rig.world.destroy(ball.entity.id);
    rig.world.reconcile();
    expect(heard(rig.world, zone)).toHaveLength(1);
    rig.run(STEP);
    expect(heard(rig.world, zone)).toEqual([
      ['onTriggerEnter', ball.entity.id],
      ['onTriggerExit', ball.entity.id],
    ]);

    rig.run(0.5);
    expect(heard(rig.world, zone)).toHaveLength(2);
  });

  it('a body destroyed while it touches another is heard leaving by the other', async () => {
    const floor = ground();
    const ball = withBody('sphere', [0, 0.5, 0]);
    const rig = await physicsRig([floor, ball]);
    rig.run(0.5);
    heardIn.delete(rig.world);

    rig.world.destroy(ball.entity.id);
    rig.run(0.5);

    expect(heard(rig.world, floor)).toEqual([['onCollisionExit', ball.entity.id]]);
    expect(heard(rig.world, ball)).toBeUndefined();
  });

  it('a joint whose Connected Body is destroyed holds nothing, and its body falls', async () => {
    const hook = block([0, 3, 0], [0.2, 0.2, 0.2]);
    const box = withJoint(withBody('box', [0, 2, 0], { interpolate: false }), {
      anchor: [0, 1, 0],
      connectedEntity: hook.entity.id,
      motion: { ...createJointMotion('hinge'), axis: [0, 0, 1] },
    });
    const rig = await physicsRig([hook, box]);
    const physics = assertDefined(physicsOf(rig.world), 'the world’s physics');
    rig.run(1);
    expect(physics.joint(box.entity.id)).not.toBeNull();
    expect(Math.abs(rig.solved(box.entity.id).position.y - 2)).toBeLessThan(0.01);

    rig.world.destroy(hook.entity.id);
    rig.world.reconcile();
    expect(physics.joint(box.entity.id)).toBeNull();
    rig.run(1);

    expect(rig.solved(box.entity.id).position.y).toBeLessThan(0);
  });

  it('a parent’s body made after its child’s is drawn before it, and the child is drawn at its own body', async () => {
    const arm = createEntity('Arm', []);
    arm.entity.transform.position = [0, 5, 0];
    const hand = withBody('box', [2, 0, 0], { gravityScale: 0, interpolate: false });
    const rig = await physicsRig([nest(arm, hand), hand]);
    rig.run(0.5);

    rig.world.putComponent(arm.entity.id, { ...rigidbodyType.create(), interpolate: false });
    rig.run(1);

    // The arm falls; the hand, on a body nothing moves, stays where it is.
    expect(rig.solved(arm.entity.id).position.y).toBeLessThan(2);
    expect(rig.drawn(hand.entity.id).position.distanceTo(rig.solved(hand.entity.id).position)).toBeLessThan(1e-6);
  });

  it('a hundred boxes spawned then destroyed leave the world holding what it held', async () => {
    const rig = await physicsRig([ground()]);
    rig.run(0.1);
    const before = physicsStats(rig.world);

    const boxes = Array.from({ length: 100 }, (_, i) =>
      withBody('box', [(i % 10) * 1.5 - 7, 1 + Math.floor(i / 10) * 1.5, 0]),
    );
    for (const box of boxes) rig.world.spawn(box);
    rig.run(0.5);
    expect(physicsStats(rig.world)).toMatchObject({ bodies: 101, colliders: 101 });

    for (const box of boxes) rig.world.destroy(box.entity.id);
    rig.run(0.1);

    expect(physicsStats(rig.world)).toEqual(before);
  });
});

describe('a model landing after its collider was mounted', () => {
  it('builds a mesh Collider again from the model’s meshes', async () => {
    let land = (): void => {};
    const inFlight = new Promise<Object3D>((resolve) => {
      land = () => resolve(new Group().add(new Mesh(new BoxGeometry(4, 1, 4))));
    });
    vi.spyOn(AssetCache.prototype, 'holdModel').mockReturnValue({ object: inFlight, dispose: () => {} });
    const world = await World.play({
      time: new StudioTime(),
      document: sceneWith([]),
      registries,
      assets: new AssetCache(registries, { resolver: { url: () => 'file:///slab.glb' }, idleBudgetBytes: 0 }),
      rendering: { ...createRenderingSettings(), batching: false },
      physicsSettings: createPhysicsSettings(),
    });
    onTestFinished(() => world.dispose());
    const physics = assertDefined(physicsOf(world), 'the world’s physics');

    const slab = createEntity('Slab', [
      { ...modelType.create(), assetId: fixedId('asset', 'slab') },
      { ...colliderType.create(), shape: { kind: 'mesh', build: 'triangles' } },
    ]);
    world.spawn(slab);
    world.frame(STEP);
    world.frame(STEP);
    // Nothing to build it from yet, and nothing a metre and a half out.
    expect(physics.raycast({ x: 1.5, y: 5, z: 1.5 }, DOWN, 10)).toBeNull();

    land();
    await world.binder.whenLoaded();
    // The pass that hands it back, then a tick for the queries to see it.
    world.frame(STEP);
    world.frame(STEP);

    const hit = physics.raycast({ x: 1.5, y: 5, z: 1.5 }, DOWN, 10);
    expect(hit?.entity).toBe(slab.entity.id);
    expect(Math.abs((hit?.point.y ?? 0) - 0.5)).toBeLessThan(1e-4);
  });
});
