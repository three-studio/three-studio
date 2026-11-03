import { createDefaultLayer, type EntityTemplate } from '@three-studio/core';
import { Vector3 } from 'three/webgpu';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { registerBehaviour } from '../../src/behaviour/Behaviour';
import type { Collision, Vec3Like } from '../../src/physics/PhysicsApi';
import { Behaviour } from '../../src/scripting/ScriptHost';
import {
  block,
  colliderOf,
  ground,
  nest,
  onLayer,
  physicsRig,
  player,
  sensor,
  standInForTheBrowser,
  takeTheBrowserBack,
  withBody,
  withCollider,
  withScript,
} from './rig';

/*
 * What a collider starts or stops touching is heard after the tick by the
 * behaviours of its entity, and of the entity whose body it rides. Here by an
 * Ear on every Collider: a plugin hears collisions by being a behaviour on the
 * entity, and so does this file.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

type Hook = 'onCollisionEnter' | 'onCollisionExit' | 'onTriggerEnter' | 'onTriggerExit';

interface Heard {
  readonly hook: Hook;
  readonly other: string;
  readonly collision?: Collision;
}

/** What each entity's Ear heard, in order, by entity id. */
const heard = new Map<string, Heard[]>();

// Vitest runs each test file in modules of its own, so the Ear stays in this one.
registerBehaviour('collider', ({ entity }) => {
  const record = (entry: Heard) => heard.set(entity.id, [...(heard.get(entity.id) ?? []), entry]);
  return {
    onCollisionEnter: (collision) => record({ hook: 'onCollisionEnter', other: collision.other, collision }),
    onCollisionExit: (other) => record({ hook: 'onCollisionExit', other }),
    onTriggerEnter: (other) => record({ hook: 'onTriggerEnter', other }),
    onTriggerExit: (other) => record({ hook: 'onTriggerExit', other }),
  };
});

beforeEach(() => heard.clear());

/** Each hook the template's Ear heard, and whom from. */
function said(template: EntityTemplate): [Hook, string][] {
  return (heard.get(template.entity.id) ?? []).map(({ hook, other }) => [hook, other]);
}

/** The one collision the template's Ear heard. */
function collisionOf(template: EntityTemplate): Collision {
  const [only, ...more] = heard.get(template.entity.id) ?? [];
  if (!only?.collision || more.length > 0) {
    throw new Error(`"${template.entity.name}" heard ${more.length + (only ? 1 : 0)} things, not one collision.`);
  }
  return only.collision;
}

const at = ({ x, y, z }: Readonly<Vec3Like>) => new Vector3(x, y, z);

describe('collision and trigger events', () => {
  it('a ball landing is heard once by both sides, with where, which way and how hard', async () => {
    const floor = ground();
    const ball = withBody('sphere', [0, 2, 0], { mass: 2, interpolate: false });
    const rig = await physicsRig([floor, ball]);

    // One frame at a time, the speed it lands at read the frame before it is heard.
    let landing: number | null = null;
    for (let frame = 0; frame < 60; frame++) {
      const speed = Math.abs(rig.body(ball.entity.id).linearVelocity.y);
      rig.run(1 / 60);
      if (landing === null && said(ball).length > 0) landing = speed;
    }
    if (landing === null) throw new Error('The ball was never heard landing.');

    // Stopped from its speed, and held up against its weight through the tick.
    const impulse = 2 * landing + (2 * 9.81) / 60;
    const onBall = collisionOf(ball);
    expect(onBall.other).toBe(floor.entity.id);
    expect(at(onBall.point).length()).toBeLessThan(1e-3);
    expect(at(onBall.normal).distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-6);
    expect(Math.abs(onBall.impulse - impulse)).toBeLessThan(1e-2);

    const onFloor = collisionOf(floor);
    expect(onFloor.other).toBe(ball.entity.id);
    expect(at(onFloor.point).distanceTo(at(onBall.point))).toBeLessThan(1e-9);
    expect(at(onFloor.normal).distanceTo(new Vector3(0, -1, 0))).toBeLessThan(1e-6);
    expect(onFloor.impulse).toBe(onBall.impulse);
  });

  it('a bouncing ball is heard leaving after each landing', async () => {
    const floor = ground();
    const ball = withBody('sphere', [0, 3, 0]);
    for (const template of [floor, ball]) colliderOf(template).material.restitution = 0.8;
    const rig = await physicsRig([floor, ball]);

    rig.run(5);

    const heardByBall = said(ball);
    const alternating = heardByBall.map((_, i): [Hook, string] => [
      i % 2 === 0 ? 'onCollisionEnter' : 'onCollisionExit',
      floor.entity.id,
    ]);
    expect(heardByBall).toEqual(alternating);
    expect(heardByBall.filter(([hook]) => hook === 'onCollisionEnter').length).toBeGreaterThanOrEqual(4);
  });

  it('a trigger is heard by both sides, and stops nothing', async () => {
    const zone = sensor([0, 4, 0], [2, 2, 2]);
    const ball = withBody('sphere', [0, 7, 0]);
    const floor = ground();
    const rig = await physicsRig([zone, ball, floor]);

    rig.run(3);

    expect(said(zone)).toEqual([
      ['onTriggerEnter', ball.entity.id],
      ['onTriggerExit', ball.entity.id],
    ]);
    expect(said(ball)).toEqual([
      ['onTriggerEnter', zone.entity.id],
      ['onTriggerExit', zone.entity.id],
      ['onCollisionEnter', floor.entity.id],
    ]);
    expect(Math.abs(rig.solved(ball.entity.id).position.y - 0.5)).toBeLessThan(0.02);
  });

  it('a fixed sensor sees a kinematic body, and nothing fixed', async () => {
    // Rapier's default pairs need a dynamic body on one side, and a fixed
    // sensor never saw a kinematic one move through it.
    class Glide extends Behaviour {
      override onFixedUpdate(step: number) {
        this.transform.position.x += 2 * step;
      }
    }
    const zone = sensor([0, 1, 0], [2, 2, 2]);
    const overlapping = block([0, 1, 1.25], [1, 2, 1]);
    const further = block([3, 1, 0], [1, 2, 1]);
    const box = withScript(withBody('box', [-3, 1, 0], { bodyType: 'kinematicPosition' }), Glide);
    const rig = await physicsRig([zone, overlapping, further, box]);

    rig.run(4);

    expect(rig.solved(box.entity.id).position.x).toBeGreaterThan(4.5);
    expect(said(zone)).toEqual([
      ['onTriggerEnter', box.entity.id],
      ['onTriggerExit', box.entity.id],
    ]);
    expect(said(box)).toEqual([
      ['onTriggerEnter', zone.entity.id],
      ['onTriggerExit', zone.entity.id],
    ]);
    expect(said(overlapping)).toEqual([]);
    expect(said(further)).toEqual([]);
  });

  it("a child's collider is heard by the child and by the body it rides, once each", async () => {
    const cart = withBody('box', [0, 3, 0], { lockRotation: [true, true, true] });
    const wheel = withCollider('sphere', [0, -1.5, 0]);
    nest(cart, wheel);
    const floor = ground();
    const rig = await physicsRig([cart, wheel, floor]);

    rig.run(2);

    // The wheel landed, and the cart above it touched nothing itself.
    expect(Math.abs(rig.solved(cart.entity.id).position.y - 2)).toBeLessThan(0.02);
    expect(said(wheel)).toEqual([['onCollisionEnter', floor.entity.id]]);
    expect(said(cart)).toEqual([['onCollisionEnter', floor.entity.id]]);
    // The floor hears the collider's entity, not its body's.
    expect(said(floor)).toEqual([['onCollisionEnter', wheel.entity.id]]);
    // Heard by the cart as the body the wheel rides, not through a body of the wheel's.
    expect(rig.engine.physics?.body(wheel.entity.id)).toBeNull();
  });

  it('a body held out of the world leaves its triggers, and enters them again', async () => {
    const zone = sensor([0, 0, 0], [2, 2, 2]);
    const ball = withBody('sphere', [0, 0, 0], { gravityScale: 0 });
    const rig = await physicsRig([zone, ball]);
    const body = rig.body(ball.entity.id);

    rig.run(1 / 60);
    expect(said(ball)).toEqual([['onTriggerEnter', zone.entity.id]]);

    body.enabled = false;
    rig.run(1 / 60);
    expect(said(ball)).toEqual([
      ['onTriggerEnter', zone.entity.id],
      ['onTriggerExit', zone.entity.id],
    ]);

    body.enabled = true;
    rig.run(1 / 60);
    expect(said(ball)).toEqual([
      ['onTriggerEnter', zone.entity.id],
      ['onTriggerExit', zone.entity.id],
      ['onTriggerEnter', zone.entity.id],
    ]);
  });

  it('the player walking through a trigger is heard by it, and hears it, once in and once out', async () => {
    const floor = ground();
    const zone = sensor([0, 1, -3], [2, 2, 2]);
    const walker = player([0, 1, 0]);
    const rig = await physicsRig([floor, zone, walker]);

    rig.run(0.5);
    rig.press('KeyW');
    rig.run(1.5);

    expect(said(zone)).toEqual([
      ['onTriggerEnter', walker.entity.id],
      ['onTriggerExit', walker.entity.id],
    ]);
    expect(said(walker)).toEqual([
      ['onTriggerEnter', zone.entity.id],
      ['onTriggerExit', zone.entity.id],
    ]);
    // A standing character touches nothing: its controller keeps a gap.
    expect(said(floor)).toEqual([]);
  });

  it('a ball rolling into a standing player is heard by both', async () => {
    const walker = player([0, 1, 0]);
    const ball = withBody('sphere', [0, 0.5, -3], { interpolate: false });
    const rig = await physicsRig([ground(), walker, ball]);

    rig.run(0.5);
    rig.body(ball.entity.id).linearVelocity = { x: 0, y: 0, z: 4 };
    rig.run(1.5);

    expect(said(walker)).toContainEqual(['onCollisionEnter', ball.entity.id]);
    expect(said(ball)).toContainEqual(['onCollisionEnter', walker.entity.id]);
  });

  it('a ball the player walks into is heard by neither', async () => {
    // The character's controller keeps a gap and pushes by impulses: the two
    // never touch.
    const ball = withBody('sphere', [0, 0.5, -2], { interpolate: false });
    const walker = player([0, 1, 0]);
    const rig = await physicsRig([ground(), ball, walker]);

    rig.run(0.5);
    rig.press('KeyW');
    rig.run(1.5);

    expect(rig.solved(ball.entity.id).position.z).toBeLessThan(-3);
    expect(said(walker)).toEqual([]);
    expect(said(ball).filter(([, other]) => other === walker.entity.id)).toEqual([]);
  });

  it('a sensor hears only what its layer touches', async () => {
    const layers = [
      createDefaultLayer(),
      { id: 'zone', name: 'Zone', ignores: ['b'] },
      { id: 'b', name: 'B', ignores: [] },
    ];
    const zone = onLayer(sensor([0, 4, 0], [6, 2, 2]), 'zone');
    const seen = withBody('sphere', [-1.5, 7, 0]);
    const unseen = onLayer(withBody('sphere', [1.5, 7, 0]), 'b');
    const rig = await physicsRig([zone, seen, unseen, ground()], { layers });

    rig.run(3);

    expect(said(zone)).toEqual([
      ['onTriggerEnter', seen.entity.id],
      ['onTriggerExit', seen.entity.id],
    ]);
    expect(said(unseen).filter(([, other]) => other === zone.entity.id)).toEqual([]);
    // Through the zone, onto the ground its layer still touches.
    expect(Math.abs(rig.solved(unseen.entity.id).position.y - 0.5)).toBeLessThan(0.02);
  });

  it("a ball whose layer the ground's ignores falls through it, and neither hears the other", async () => {
    const layers = [
      { ...createDefaultLayer(), ignores: ['ghost'] },
      { id: 'ghost', name: 'Ghost', ignores: [] },
    ];
    const floor = ground();
    const ball = onLayer(withBody('sphere', [0, 2, 0]), 'ghost');
    const rig = await physicsRig([floor, ball], { layers });

    rig.run(1);

    expect(rig.solved(ball.entity.id).position.y).toBeLessThan(-1);
    expect(said(ball)).toEqual([]);
    expect(said(floor)).toEqual([]);
  });

  it('what touches when the world is built is heard once, at the first tick', async () => {
    const floor = ground();
    const ball = withBody('sphere', [0, 0.5, 0], { interpolate: false });
    const rig = await physicsRig([floor, ball]);

    expect(said(ball)).toEqual([]);
    rig.run(1 / 60);
    expect(said(ball)).toEqual([['onCollisionEnter', floor.entity.id]]);
    expect(said(floor)).toEqual([['onCollisionEnter', ball.entity.id]]);

    rig.run(1);
    expect(said(ball)).toHaveLength(1);
    expect(said(floor)).toHaveLength(1);
  });
});
