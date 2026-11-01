import {
  createColliderShape,
  createDefaultLayer,
  createPhysicsMaterial,
  createPhysicsSettings,
  createRenderingSettings,
  type CollisionLayer,
  type EntityTemplate,
  type PhysicsMaterialDef,
} from '@three-studio/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import { sceneWith } from '../../../core/test/fixtures';
import { registerBehaviour } from '../../src/behaviour/Behaviour';
import { Engine } from '../../src/Engine';
import { NULL_ASSET_RESOLVER } from '../../src/assets/AssetResolver';
import {
  colliderOf,
  componentOf,
  ground,
  physicsRig,
  player,
  standInForTheBrowser,
  takeTheBrowserBack,
  withBody,
  withCollider,
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
