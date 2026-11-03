import {
  createColliderShape,
  createDefaultLayer,
  createJointMotion,
  createPhysicsMaterial,
  createPhysicsSettings,
  createRenderingSettings,
  type CollisionLayer,
  type EntityTemplate,
  type JointLimits,
  type JointMotion,
  type PhysicsMaterialDef,
  type Vec3,
} from '@three-studio/core';
import { Vector3 } from 'three/webgpu';
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import { sceneWith } from '../../../core/test/fixtures';
import { registerBehaviour } from '../../src/behaviour/Behaviour';
import { Engine } from '../../src/Engine';
import { NULL_ASSET_RESOLVER } from '../../src/assets/AssetResolver';
import type { JointHandle } from '../../src/physics/PhysicsApi';
import { Behaviour } from '../../src/scripting/ScriptHost';
import {
  block,
  colliderOf,
  componentOf,
  ground,
  physicsRig,
  player,
  standInForTheBrowser,
  takeTheBrowserBack,
  withBody,
  withCollider,
  withJoint,
  withScript,
  type PhysicsRig,
} from './rig';

/*
 * The editor's live tuning: a Rigid Body's, a Collider's or a physics
 * material's values applied to the running world at once, as it would have
 * built them. Each component is read from its template and changed with a
 * spread, as the Inspector hands a tuned one over.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

type Hook = 'onCollisionEnter' | 'onCollisionExit' | 'onTriggerEnter' | 'onTriggerExit';

/** What each entity's collider heard, in order, by entity id. */
const heard = new Map<string, [Hook, string][]>();

// An Ear on every Collider, as F8's events file has.
registerBehaviour('collider', ({ entity }) => {
  const record = (hook: Hook, other: string) => heard.set(entity.id, [...(heard.get(entity.id) ?? []), [hook, other]]);
  return {
    onCollisionEnter: ({ other }) => record('onCollisionEnter', other),
    onCollisionExit: (other) => record('onCollisionExit', other),
    onTriggerEnter: (other) => record('onTriggerEnter', other),
    onTriggerExit: (other) => record('onTriggerExit', other),
  };
});

beforeEach(() => heard.clear());

/** A 30° slope whose own friction, 0.2, holds nothing: tan 30° is 0.58. */
function slope(): EntityTemplate {
  const template = ground(30);
  colliderOf(template).material = { ...colliderOf(template).material, friction: 0.2 };
  return template;
}

/**
 * `ground(30)` drawn by a box mesh and built from its triangles, at friction
 * 1: a tune keeps a mesh's shape rather than build it from its vertices again.
 */
function meshSlope(): EntityTemplate {
  const template = withCollider('box', [0, 0, 0]);
  template.entity.transform = { ...ground(30).entity.transform, scale: [40, 1, 40] };
  const collider = colliderOf(template);
  collider.shape = { kind: 'mesh', build: 'triangles' };
  collider.material = { ...collider.material, friction: 1 };
  return template;
}

/** A box that cannot turn, placed to land on the slope. */
function boxOnSlope(z: number): EntityTemplate {
  return withBody('box', [0, 1, z], { lockRotation: [true, true, true] });
}

/** A hinge on this axis, its limits as given and otherwise as made. */
function hinge(axis: Vec3, limits?: Partial<JointLimits>): JointMotion {
  const made = createJointMotion('hinge');
  return { ...made, axis, limits: { ...made.limits, ...limits } };
}
const slider = (axis: Vec3): JointMotion => ({ ...createJointMotion('slider'), axis });
const spring = (stiffness: number, damping: number): JointMotion => ({
  ...createJointMotion('spring'),
  stiffness,
  damping,
});
const degrees = (angle: number) => (angle * Math.PI) / 180;

/**
 * F12's pendulum: a 1 m box hinged to the world on z at (0, 2, 0), level to
 * start with. Slowed by a linear damping, so that it comes to hang: an angular
 * one barely slows a body turning about a pivot rather than about itself.
 */
function pendulum(): EntityTemplate {
  return withJoint(withBody('box', [1, 2, 0], { interpolate: false, linearDamping: 2 }), {
    anchor: [-1, 0, 0],
    motion: hinge([0, 0, 1]),
  });
}

/** The template's joint, as a behaviour reaches it. */
const jointOf = (rig: PhysicsRig, template: EntityTemplate) => rig.engine.physics?.joint(template.entity.id) ?? null;

const grip: PhysicsMaterialDef = { ...createPhysicsMaterial(), friction: 1, frictionCombine: 'max' };
const ice: PhysicsMaterialDef = { ...createPhysicsMaterial(), friction: 0, frictionCombine: 'min' };

describe('a body tuned while running', () => {
  it('a mass tuned while running is what the next impulse feels', async () => {
    const ball = withBody('sphere', [0, 2, 0], { mass: 2, gravityScale: 0 });
    const rig = await physicsRig([ball]);

    rig.engine.tune(ball.entity.id, { ...componentOf(ball, 'rigidbody'), mass: 4 });

    const body = rig.body(ball.entity.id);
    expect(Math.abs(body.mass - 4)).toBeLessThan(1e-6);
    body.applyImpulse({ x: 8, y: 0, z: 0 });
    expect(Math.abs(body.linearVelocity.x - 2)).toBeLessThan(1e-6);
  });

  it('a body whose only collider was a sensor weighs its mass once that collider is tuned solid', async () => {
    const ball = withBody('sphere', [0, 2, 0], { mass: 2, gravityScale: 0 });
    colliderOf(ball).isSensor = true;
    const rig = await physicsRig([ball]);

    rig.engine.tune(ball.entity.id, { ...colliderOf(ball), isSensor: false });

    // Not its colliders' share on top of the mass a sensor alone carried whole.
    expect(Math.abs(rig.body(ball.entity.id).mass - 2)).toBeLessThan(1e-6);
  });

  it('a sleeping body is woken by its tune: a ball at rest, its gravity reversed, rises', async () => {
    const ball = withBody('sphere', [0, 1, 0]);
    const rig = await physicsRig([ground(), ball]);
    rig.run(3);
    const rested = rig.solved(ball.entity.id).position.y;

    rig.engine.tune(ball.entity.id, { ...componentOf(ball, 'rigidbody'), gravityScale: -1 });
    rig.run(1);

    expect(rig.solved(ball.entity.id).position.y - rested).toBeGreaterThan(4);
  });

  it('a body tuned from Kinematic to Dynamic falls, and one tuned to Fixed stops where it is', async () => {
    const crate = withBody('box', [3, 3, 0], { bodyType: 'kinematicPosition' });
    const ball = withBody('sphere', [0, 10, 0]);
    const rig = await physicsRig([ground(), crate, ball]);

    rig.engine.tune(crate.entity.id, { ...componentOf(crate, 'rigidbody'), bodyType: 'dynamic' });
    rig.run(0.5);
    rig.engine.tune(ball.entity.id, { ...componentOf(ball, 'rigidbody'), bodyType: 'fixed' });
    const stopped = rig.solved(ball.entity.id).position;
    rig.run(1);

    // Drawn where the solver has it: the world draws a body it now drives.
    expect(3 - rig.solved(crate.entity.id).position.y).toBeGreaterThan(2);
    expect(rig.drawn(crate.entity.id).position.distanceTo(rig.solved(crate.entity.id).position)).toBeLessThan(0.01);
    expect(rig.solved(ball.entity.id).position.distanceTo(stopped)).toBeLessThan(1e-6);
    // And drawn there, where it stopped, not up to a tick behind.
    expect(rig.drawn(ball.entity.id).position.distanceTo(stopped)).toBeLessThan(1e-6);
  });

  it('a Triangles mesh on a body tuned Dynamic is built as its hull', async () => {
    const torus = withBody('torus', [0, 0.15, 0], { bodyType: 'fixed' });
    torus.entity.transform.rotation = [-Math.PI / 2, 0, 0];
    colliderOf(torus).shape = { kind: 'mesh', build: 'triangles' };
    const ball = withBody('sphere', [0, 1, 0], { gravityScale: 0 });
    ball.entity.transform.scale = [0.2, 0.2, 0.2];
    const rig = await physicsRig([ground(), torus, ball]);

    rig.engine.tune(torus.entity.id, { ...componentOf(torus, 'rigidbody'), bodyType: 'dynamic' });
    rig.engine.tune(ball.entity.id, { ...componentOf(ball, 'rigidbody'), gravityScale: 1 });
    rig.run(2);

    // The hull's top is at 0.3; through the triangles it reached the ground, at 0.1.
    expect(rig.solved(ball.entity.id).position.y).toBeGreaterThan(0.3);
  });

  it('a character’s body is driven by its controller, whatever its tuned type', async () => {
    const walker = player([0, 1, 0]);
    const rig = await physicsRig([ground(), walker]);
    rig.run(0.5);

    rig.engine.tune(walker.entity.id, { ...componentOf(walker, 'rigidbody'), bodyType: 'dynamic' });
    const from = rig.drawn(walker.entity.id).position;
    rig.press('KeyW');
    rig.run(1);

    expect(from.z - rig.drawn(walker.entity.id).position.z).toBeGreaterThan(4);
  });

  it('a lock tuned on while a ball falls stops it there', async () => {
    const ball = withBody('sphere', [0, 10, 0]);
    const rig = await physicsRig([ball]);
    rig.run(0.5);

    rig.engine.tune(ball.entity.id, { ...componentOf(ball, 'rigidbody'), lockPosition: [false, true, false] });
    const held = rig.solved(ball.entity.id).position.y;
    rig.run(1);

    expect(Math.abs(rig.solved(ball.entity.id).position.y - held)).toBeLessThan(1e-6);
  });
});

describe('a collider tuned while running', () => {
  it('a friction tuned to nothing lets a box resting on a slope slide', async () => {
    const tilted = meshSlope();
    const box = boxOnSlope(0);
    colliderOf(box).material = { ...colliderOf(box).material, friction: 1 };
    const rig = await physicsRig([tilted, box]);
    rig.run(2);
    const rested = rig.solved(box.entity.id).position;

    const collider = colliderOf(tilted);
    rig.engine.tune(tilted.entity.id, {
      ...collider,
      material: { ...collider.material, friction: 0, frictionCombine: 'min' },
    });
    rig.run(1);

    expect(rig.solved(box.entity.id).position.distanceTo(rested)).toBeGreaterThan(0.5);
  });

  it('a collider resized while running holds what rests on it at its new size', async () => {
    // Its top at 1, the ball resting on it at 1.5.
    const step = withCollider('box', [0, 0.5, 0]);
    const ball = withBody('sphere', [0, 2, 0]);
    const rig = await physicsRig([step, ball]);
    rig.run(2);

    rig.engine.tune(step.entity.id, { ...colliderOf(step), shape: { ...createColliderShape('box'), size: [1, 2, 1] } });
    rig.run(1);

    expect(Math.abs(rig.solved(ball.entity.id).position.y - 2)).toBeLessThan(0.02);
  });

  it('a collider tuned to a sensor lets through what rested on it, and is heard as a trigger', async () => {
    const floor = ground();
    const ball = withBody('sphere', [0, 1, 0]);
    const rig = await physicsRig([floor, ball]);
    rig.run(2);
    heard.clear();

    rig.engine.tune(floor.entity.id, { ...colliderOf(floor), isSensor: true });
    rig.run(1);

    expect(rig.solved(ball.entity.id).position.y).toBeLessThan(-1);
    // Its contact's end heard as a contact's, then the zone it falls through.
    expect(heard.get(ball.entity.id)).toEqual([
      ['onCollisionExit', floor.entity.id],
      ['onTriggerEnter', floor.entity.id],
      ['onTriggerExit', floor.entity.id],
    ]);
  });

  it('a collider moved to a layer the other’s ignores lets it through', async () => {
    const layers: CollisionLayer[] = [
      createDefaultLayer(),
      { id: 'ghost', name: 'Ghost', ignores: [createDefaultLayer().id] },
    ];
    const ball = withBody('sphere', [0, 1, 0]);
    const rig = await physicsRig([ground(), ball], { layers });
    rig.run(2);

    rig.engine.tune(ball.entity.id, { ...colliderOf(ball), layer: 'ghost' });
    rig.run(1);

    expect(rig.solved(ball.entity.id).position.y).toBeLessThan(-1);
  });

  it('a physics material tuned while running changes every collider that links it', async () => {
    const boxes = [boxOnSlope(1.5), boxOnSlope(-1.5)];
    for (const box of boxes) colliderOf(box).materialId = 'grip';
    const rig = await physicsRig([slope(), ...boxes], undefined, { grip });
    rig.run(2);
    const rested = boxes.map((box) => rig.solved(box.entity.id).position);

    rig.engine.tunePhysicsMaterial('grip', ice);
    rig.run(1);

    boxes.forEach((box, i) => {
      expect(rig.solved(box.entity.id).position.distanceTo(rested[i]!)).toBeGreaterThan(0.5);
    });
  });

  it('a tune is in the debug view at once, paused or not', async () => {
    const ball = withBody('sphere', [0, 2, 0]);
    const rig = await physicsRig([ground(), ball]);
    const before = Array.from(rig.engine.physicsDebug()?.vertices ?? []);

    rig.engine.tune(ball.entity.id, { ...colliderOf(ball), shape: { ...createColliderShape('sphere'), radius: 1 } });

    expect(Array.from(rig.engine.physicsDebug()?.vertices ?? [])).not.toEqual(before);
  });
});

describe('a joint tuned while running', () => {
  it('a spring stiffened while running hangs m·g / k below where it was built', async () => {
    const bag = withJoint(withBody('sphere', [0, 2, 0], { mass: 1, interpolate: false }), { motion: spring(100, 5) });
    const rig = await physicsRig([bag]);
    rig.run(5);

    rig.engine.tune(bag.entity.id, { ...componentOf(bag, 'joint'), motion: spring(25, 5) });
    rig.run(5);

    // m·g / k: 9.81 / 25.
    const sag = 2 - rig.solved(bag.entity.id).position.y;
    expect(Math.abs(sag - 0.392) / 0.392).toBeLessThan(0.05);
  });

  it('a hinge’s limits tuned on while it hangs stop it at them', async () => {
    const box = pendulum();
    const rig = await physicsRig([box]);
    rig.run(6);

    const limited = hinge([0, 0, 1], { enabled: true, min: degrees(-30), max: degrees(30) });
    rig.engine.tune(box.entity.id, { ...componentOf(box, 'joint'), motion: limited });
    rig.run(2);

    expect(Math.abs((jointOf(rig, box)?.position ?? 0) - degrees(-30))).toBeLessThan(degrees(0.5));
  });

  it('a hinge whose limits are tuned off turns freely again', async () => {
    const box = pendulum();
    const rig = await physicsRig([box]);
    const joint = componentOf(box, 'joint');
    const limits = { enabled: true, min: degrees(-30), max: degrees(30) };
    rig.run(6);
    rig.engine.tune(box.entity.id, { ...joint, motion: hinge([0, 0, 1], limits) });
    rig.run(2);

    // Rapier has no setter to switch a live joint's limits off.
    rig.engine.tune(box.entity.id, { ...joint, motion: hinge([0, 0, 1], { ...limits, enabled: false }) });
    rig.run(6);

    expect(Math.abs((jointOf(rig, box)?.position ?? 0) - degrees(-90))).toBeLessThan(degrees(1));
  });

  it('a hinge given another anchor turns about it, as placed when the world was built', async () => {
    const box = pendulum();
    const rig = await physicsRig([box]);
    rig.run(1);

    rig.engine.tune(box.entity.id, { ...componentOf(box, 'joint'), anchor: [-0.5, 0, 0] });
    // Pulled there in a tick, and swinging hard from it: still swinging after
    // 6 s, it falls asleep at 10 s a degree short of the bottom.
    rig.run(0.5);

    // Its anchor held at (0.5, 2, 0), where that anchor was when the world was
    // built, on every frame of the swing, and its centre swinging through 0.5 m
    // below it.
    const pivot = new Vector3(0.5, 2, 0);
    let farthest = 0;
    let lowest = Number.POSITIVE_INFINITY;
    for (let frame = 0; frame < 300; frame++) {
      rig.run(1 / 60);
      const { position, quaternion } = rig.solved(box.entity.id);
      const anchor = new Vector3(-0.5, 0, 0).applyQuaternion(quaternion).add(position);
      farthest = Math.max(farthest, anchor.distanceTo(pivot));
      lowest = Math.min(lowest, position.y);
    }
    expect(farthest).toBeLessThan(1e-3);
    expect(Math.abs(lowest - 1.5)).toBeLessThan(0.01);
  });

  it('a joint tuned to another Connected Body is held to that one', async () => {
    class Glide extends Behaviour {
      override onFixedUpdate(step: number) {
        this.transform.position.x += 2 * step;
      }
    }
    // Hinged to the world at its top, and a block beside it sliding away.
    const box = withJoint(withBody('box', [0, 2, 0], { interpolate: false }), {
      anchor: [0, 0.5, 0],
      motion: hinge([0, 0, 1]),
    });
    const sled = withScript(withBody('box', [2, 2, 0], { bodyType: 'kinematicPosition' }), Glide);
    const rig = await physicsRig([box, sled]);

    rig.engine.tune(box.entity.id, { ...componentOf(box, 'joint'), connectedEntity: sled.entity.id });
    rig.run(1);

    expect(rig.solved(box.entity.id).position.x).toBeGreaterThan(1.5);
  });

  it('a joint that held nothing holds once its Connected Body is tuned to one with a body', async () => {
    const hook = block([0, 3, 0], [0.2, 0.2, 0.2]);
    const box = withJoint(withBody('box', [0, 2, 0], { interpolate: false, linearDamping: 2 }), {
      anchor: [0, 1, 0],
      connectedEntity: 'gone',
      motion: hinge([0, 0, 1]),
    });
    const rig = await physicsRig([hook, box]);
    expect(jointOf(rig, box)).toBeNull();
    rig.run(0.5);
    expect(rig.solved(box.entity.id).position.y).toBeLessThan(1.5);

    rig.engine.tune(box.entity.id, { ...componentOf(box, 'joint'), connectedEntity: hook.entity.id });
    expect(jointOf(rig, box)).not.toBeNull();
    rig.run(3);

    // Hanging from the hook, as placed when the world was built.
    expect(rig.solved(box.entity.id).position.distanceTo(new Vector3(0, 2, 0))).toBeLessThan(0.05);
  });

  it('a script’s handle drives the joint that replaced it', async () => {
    /** Keeps its door's joint from the start, and opens the door with it when told. */
    class Keeper extends Behaviour {
      static kept: JointHandle | null = null;
      static open = false;

      override onStart() {
        Keeper.kept = this.physics.joint(this.entity.id);
      }

      override onUpdate() {
        if (!Keeper.open || !Keeper.kept) return;
        Keeper.kept.motorSpeed = 2;
        Keeper.kept.motorEnabled = true;
      }
    }
    const motion = createJointMotion('hinge');
    const door = withScript(
      withJoint(withBody('box', [0.5, 1, 0]), {
        anchor: [-0.5, 0, 0],
        motion: { ...motion, limits: { enabled: true, min: 0, max: Math.PI / 2 } },
      }),
      Keeper,
    );
    const rig = await physicsRig([door]);

    const joint = componentOf(door, 'joint');
    rig.engine.tune(door.entity.id, {
      ...joint,
      motion: { ...motion, limits: { enabled: true, min: 0, max: Math.PI / 4 } },
    });
    Keeper.open = true;
    rig.run(1.5);

    expect(Math.abs((Keeper.kept?.position ?? 0) - Math.PI / 4)).toBeLessThan(0.01);
  });

  it('a hinge tuned to a slider slides along its axis', async () => {
    // F12's slider, built as a hinge about the box's own centre: it holds still.
    const rail = block([0, 3, 0], [0.5, 0.5, 0.5]);
    rail.entity.transform.rotation = [degrees(20), 0, 0];
    const box = withJoint(withBody('box', [2, 3, 1], { interpolate: false }), {
      connectedEntity: rail.entity.id,
      motion: hinge([1, 1, 0]),
    });
    const rig = await physicsRig([rail, box]);
    rig.run(0.5);
    const held = rig.solved(box.entity.id);

    rig.engine.tune(box.entity.id, { ...componentOf(box, 'joint'), motion: slider([1, 1, 0]) });
    rig.run(0.5);

    const { position, quaternion } = rig.solved(box.entity.id);
    const moved = position.clone().sub(held.position);
    const along = new Vector3(1, 1, 0).normalize();
    const across = moved.clone().sub(along.clone().multiplyScalar(moved.dot(along)));
    expect(moved.dot(along)).toBeLessThan(-0.5);
    expect(across.length()).toBeLessThan(1e-6);
    expect(quaternion.angleTo(held.quaternion)).toBeLessThan(1e-3);
  });
});

describe('a tune the world cannot take', () => {
  it('what the world did not build changes nothing, and nothing throws', async () => {
    const floor = ground();
    const ball = withBody('sphere', [0, 1, 0]);
    const rig = await physicsRig([floor, ball]);
    rig.run(1);
    const rested = rig.solved(ball.entity.id).position;

    // A collider whose id the entity does not carry; a Rigid Body on level
    // geometry, which has none; an entity the scene does not have.
    rig.engine.tune(floor.entity.id, { ...colliderOf(floor), id: 'gone', isSensor: true });
    rig.engine.tune(floor.entity.id, { ...componentOf(ball, 'rigidbody'), bodyType: 'dynamic' });
    rig.engine.tune('nobody', { ...colliderOf(floor), isSensor: true });
    rig.run(1);

    expect(rig.solved(ball.entity.id).position.distanceTo(rested)).toBeLessThan(1e-3);
    expect(rig.solved(floor.entity.id).position.distanceTo(rig.drawn(floor.entity.id).position)).toBeLessThan(1e-6);

    const off = await Engine.create({
      scene: sceneWith([ground(), ball]),
      resolver: NULL_ASSET_RESOLVER,
      rendering: createRenderingSettings(),
      physicsSettings: createPhysicsSettings(),
      domElement: new EventTarget() as unknown as HTMLElement,
      enablePhysics: false,
    });
    onTestFinished(() => off.dispose());
    off.tune(ball.entity.id, { ...componentOf(ball, 'rigidbody'), mass: 4 });
    off.tunePhysicsMaterial('grip', ice);
    expect(off.physicsDebug()).toBeNull();
  });
});
