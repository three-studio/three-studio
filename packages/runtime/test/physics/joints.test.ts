import {
  createEntity,
  createJointMotion,
  type EntityTemplate,
  type JointMotion,
  type Vec3,
} from '@three-studio/core';
import { Euler, Quaternion, Vector3 } from 'three/webgpu';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { registerBehaviour } from '../../src/behaviour/Behaviour';
import {
  block,
  nest,
  physicsRig,
  standInForTheBrowser,
  takeTheBrowserBack,
  withBody,
  withJoint,
  type PhysicsRig,
} from './rig';

/*
 * A joint holds two bodies where they were built: the body of its own entity
 * against the body of the entity it names, or against the world.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

/** Whom each entity's collider heard start touching, by entity id. */
const heard = new Map<string, string[]>();

// An Ear on every Collider, as F8's events file has: a plugin hears collisions
// by being a behaviour on the entity.
registerBehaviour('collider', ({ entity }) => ({
  onCollisionEnter: ({ other }) => heard.set(entity.id, [...(heard.get(entity.id) ?? []), other]),
}));

beforeEach(() => heard.clear());

const hinge = (axis: Vec3): JointMotion => ({ ...createJointMotion('hinge'), axis });
const slider = (axis: Vec3): JointMotion => ({ ...createJointMotion('slider'), axis });
const spring = (stiffness: number, damping: number): JointMotion => ({
  ...createJointMotion('spring'),
  stiffness,
  damping,
});

/** A 1 m box hinged to the world on z at its left face's middle, (0, 2, 0), level to start with. */
function pendulum(): EntityTemplate {
  return withJoint(withBody('box', [1, 2, 0], { interpolate: false }), {
    anchor: [-1, 0, 0],
    motion: hinge([0, 0, 1]),
  });
}

/**
 * How a body swung over `seconds`, frame by frame: how far the point `anchor`
 * of its frame ever came off `pivot`, how far it ever left the plane z = 0, and
 * the lowest its centre went.
 */
function swing(rig: PhysicsRig, entityId: string, anchor: Vector3, pivot: Vector3, seconds: number) {
  let farthest = 0;
  let offPlane = 0;
  let lowest = Number.POSITIVE_INFINITY;
  for (let frame = 0; frame < Math.round(seconds * 60); frame++) {
    rig.run(1 / 60);
    const { position, quaternion } = rig.solved(entityId);
    farthest = Math.max(farthest, anchor.clone().applyQuaternion(quaternion).add(position).distanceTo(pivot));
    offPlane = Math.max(offPlane, Math.abs(position.z));
    lowest = Math.min(lowest, position.y);
  }
  return { farthest, offPlane, lowest };
}

describe('a joint', () => {
  it('a hinge holds its anchor and turns about its axis', async () => {
    const box = pendulum();
    const rig = await physicsRig([box]);

    const swung = swing(rig, box.entity.id, new Vector3(-1, 0, 0), new Vector3(0, 2, 0), 2);

    expect(swung.farthest).toBeLessThan(1e-3);
    expect(swung.offPlane).toBeLessThan(1e-3);
    expect(swung.lowest).toBeLessThan(1.5);
  });

  it('a hinge built between bodies turned unlike holds them as placed', async () => {
    // One axis for both bodies' spaces would wrench these two into line.
    const frame = block([0, 2, 0], [0.2, 0.2, 0.2]);
    frame.entity.transform.rotation = [0, 0, Math.PI / 6];
    const ball = withBody('sphere', [1, 2, 0], { interpolate: false });
    ball.entity.transform.rotation = [0, Math.PI / 4, 0];
    // The frame's place, and the world's z, in the ball's turned frame.
    const unturn = new Quaternion().setFromEuler(new Euler(0, Math.PI / 4, 0)).invert();
    const anchor = new Vector3(-1, 0, 0).applyQuaternion(unturn);
    const axis = new Vector3(0, 0, 1).applyQuaternion(unturn);
    withJoint(ball, {
      connectedEntity: frame.entity.id,
      anchor: anchor.toArray(),
      motion: hinge(axis.toArray()),
    });
    const rig = await physicsRig([frame, ball]);

    rig.run(1 / 60);

    // A tick of gravity drops it a millimetre or two.
    const { position, quaternion } = rig.solved(ball.entity.id);
    expect(position.distanceTo(new Vector3(1, 2, 0))).toBeLessThan(0.01);
    expect(anchor.clone().applyQuaternion(quaternion).add(position).distanceTo(new Vector3(0, 2, 0))).toBeLessThan(
      1e-3,
    );
  });

  it('a slider moves along its axis only, and does not turn', async () => {
    const rail = block([0, 3, 0], [0.5, 0.5, 0.5]);
    rail.entity.transform.rotation = [(20 * Math.PI) / 180, 0, 0];
    const box = withJoint(withBody('box', [2, 3, 1], { interpolate: false }), {
      connectedEntity: rail.entity.id,
      motion: slider([1, 1, 0]),
    });
    const rig = await physicsRig([rail, box]);
    const built = rig.solved(box.entity.id);

    rig.run(0.5);

    const { position, quaternion } = rig.solved(box.entity.id);
    const moved = position.clone().sub(built.position);
    const along = new Vector3(1, 1, 0).normalize();
    const across = moved.clone().sub(along.clone().multiplyScalar(moved.dot(along)));
    // Down the rail, under gravity.
    expect(moved.dot(along)).toBeLessThan(-0.5);
    expect(across.length()).toBeLessThan(1e-6);
    expect(quaternion.angleTo(built.quaternion)).toBeLessThan(1e-3);
  });

  it('a fixed joint holds two bodies as one', async () => {
    const first = withBody('box', [0, 2, 0], { gravityScale: 0, interpolate: false });
    const second = withJoint(withBody('box', [1.5, 2, 0], { gravityScale: 0, interpolate: false }), {
      connectedEntity: first.entity.id,
      motion: createJointMotion('fixed'),
    });
    const rig = await physicsRig([first, second]);
    const kicked = rig.body(first.entity.id);
    kicked.applyImpulse({ x: 0, y: 1, z: 2 });
    kicked.applyTorqueImpulse({ x: 0.5, y: 0.2, z: 0 });

    rig.run(2);

    const a = rig.solved(first.entity.id);
    const b = rig.solved(second.entity.id);
    const unturn = a.quaternion.clone().invert();
    expect(a.position.distanceTo(new Vector3(0, 2, 0))).toBeGreaterThan(1);
    expect(b.position.clone().sub(a.position).applyQuaternion(unturn).distanceTo(new Vector3(1.5, 0, 0))).toBeLessThan(
      1e-3,
    );
    expect(unturn.multiply(b.quaternion).angleTo(new Quaternion())).toBeLessThan(1e-2);
  });

  it('a spring pulls its anchor back to where it was built, hanging about m·g / k below', async () => {
    const bag = withJoint(withBody('sphere', [0, 3, 0], { mass: 1, interpolate: false }), {
      motion: spring(100, 5),
    });
    const hanging = await physicsRig([bag]);

    hanging.run(5);

    const sag = 3 - hanging.solved(bag.entity.id).position.y;
    expect(Math.abs(sag - 9.81 / 100) / (9.81 / 100)).toBeLessThan(0.05);

    // Undamped and weightless, pulled 0.5 m aside and let go.
    const weight = withJoint(withBody('sphere', [0, 3, 0], { mass: 1, gravityScale: 0, interpolate: false }), {
      motion: spring(100, 0),
    });
    const swinging = await physicsRig([weight]);
    const body = swinging.body(weight.entity.id);
    body.teleport({ x: 0.5, y: 3, z: 0 });

    // The times it crosses its rest going one way, read between frames.
    const crossings: number[] = [];
    let before = body.position.x;
    for (let frame = 0; frame < 240; frame++) {
      swinging.run(1 / 60);
      const x = body.position.x;
      if (before > 0 && x <= 0) crossings.push((frame + before / (before - x)) / 60);
      before = x;
    }
    const period = (crossings.at(-1)! - crossings[0]!) / (crossings.length - 1);
    expect(crossings.length).toBeGreaterThan(3);
    expect(Math.abs(period / (2 * Math.PI * Math.sqrt(1 / 100)) - 1)).toBeLessThan(0.01);
  });

  it("a joint on a child holds its parent's body at the child's place", async () => {
    // A door's hinge: an empty child at its edge.
    const door = withBody('box', [1, 2, 0], { interpolate: false });
    const edge = withJoint(createEntity('Hinge'), { motion: hinge([0, 0, 1]) });
    edge.entity.transform.position = [-1, 0, 0];
    nest(door, edge);
    const rig = await physicsRig([door, edge]);

    const swung = swing(rig, door.entity.id, new Vector3(-1, 0, 0), new Vector3(0, 2, 0), 2);

    expect(swung.farthest).toBeLessThan(1e-3);
    expect(swung.offPlane).toBeLessThan(1e-3);
    expect(swung.lowest).toBeLessThan(1.5);
  });

  it('jointed bodies built into each other stay as built, and neither hears the other', async () => {
    // Rapier lets the two bodies of a joint collide unless it is told not to:
    // these two drifted 1.7 cm apart each, and were heard touching.
    const first = withBody('box', [0, 2, 0], { gravityScale: 0, interpolate: false });
    const second = withJoint(withBody('box', [0.6, 2, 0], { gravityScale: 0, interpolate: false }), {
      connectedEntity: first.entity.id,
      motion: createJointMotion('fixed'),
    });
    const rig = await physicsRig([first, second]);

    rig.run(2);

    expect(rig.solved(first.entity.id).position.distanceTo(new Vector3(0, 2, 0))).toBeLessThan(1e-6);
    expect(rig.solved(second.entity.id).position.distanceTo(new Vector3(0.6, 2, 0))).toBeLessThan(1e-6);
    expect(heard.get(first.entity.id)).toBeUndefined();
    expect(heard.get(second.entity.id)).toBeUndefined();
  });

  it('building the world with joints moves nothing', async () => {
    const swinging = pendulum();
    const rail = block([0, 3, 0], [0.5, 0.5, 0.5]);
    rail.entity.transform.rotation = [0.25, 0, 0];
    const sliding = withJoint(withBody('box', [2, 3, 1]), {
      connectedEntity: rail.entity.id,
      motion: slider([1, 1, 0]),
    });
    const first = withBody('box', [0, 6, 0]);
    first.entity.transform.rotation = [0, 0.5, 0];
    const welded = withJoint(withBody('box', [1.5, 6, 0]), {
      connectedEntity: first.entity.id,
      motion: createJointMotion('fixed'),
    });
    const bag = withJoint(withBody('sphere', [-3, 3, 0]), { motion: spring(100, 5) });
    const bodies = [swinging, sliding, first, welded, bag];
    const rig = await physicsRig([rail, ...bodies]);

    for (const template of bodies) {
      const { position, quaternion } = rig.solved(template.entity.id);
      const [x, y, z] = template.entity.transform.position;
      const built = new Quaternion().setFromEuler(new Euler(...template.entity.transform.rotation));
      expect(position.distanceTo(new Vector3(x, y, z))).toBeLessThan(1e-9);
      // Rapier keeps a rotation in single precision.
      expect(quaternion.angleTo(built)).toBeLessThan(1e-6);
    }
  });
});
