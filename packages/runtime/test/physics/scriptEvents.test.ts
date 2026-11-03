import { createEntity, createRenderingSettings, type EntityTemplate } from '@three-studio/core';
import { Vector3 } from 'three/webgpu';
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { sceneWith } from '../../../core/test/fixtures';
import { Engine } from '../../src/Engine';
import { NULL_ASSET_RESOLVER } from '../../src/assets/AssetResolver';
import type { BodyHandle, Collision } from '../../src/physics/PhysicsApi';
import { Behaviour } from '../../src/scripting/ScriptHost';
import {
  ground,
  nest,
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
 * A script hears what its entity's colliders, and those of children riding its
 * body, start or stop touching: four hooks, run after the physics tick.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

interface Logged {
  readonly entity: string;
  readonly hook: string;
  readonly other: string;
  /** The body the other moves with, as the script reads it. */
  readonly body: BodyHandle | null;
}

/** What every `Log` heard, in order. */
const logged: Logged[] = [];

beforeEach(() => {
  logged.length = 0;
});

/** Records each hook it hears, and the body the other moves with. */
class Log extends Behaviour {
  override onCollisionEnter(collision: Collision) {
    this.record('onCollisionEnter', collision.other);
  }

  override onCollisionExit(other: string) {
    this.record('onCollisionExit', other);
  }

  override onTriggerEnter(other: string) {
    this.record('onTriggerEnter', other);
  }

  override onTriggerExit(other: string) {
    this.record('onTriggerExit', other);
  }

  private record(hook: string, other: string) {
    logged.push({ entity: this.entity.id, hook, other, body: this.physics.body(other) });
  }
}

/** Each hook the template's `Log` heard, and whom from. */
function heardBy(template: EntityTemplate): [string, string][] {
  return logged.filter(({ entity }) => entity === template.entity.id).map(({ hook, other }) => [hook, other]);
}

describe('a script hearing its colliders', () => {
  it("hears its ball land, and the floor's script kicks it back up", async () => {
    class Pad extends Behaviour {
      override onCollisionEnter(collision: Collision) {
        this.physics.body(collision.other)?.applyImpulse({ x: 0, y: 20, z: 0 });
      }
    }
    class Landing extends Behaviour {
      static heard: Collision | null = null;

      override onCollisionEnter(collision: Collision) {
        Landing.heard ??= collision;
      }
    }
    const floor = withScript(ground(), Pad);
    const ball = withScript(withBody('sphere', [0, 2, 0], { mass: 2, interpolate: false }), Landing);
    const rig = await physicsRig([floor, ball]);

    for (let frame = 0; frame < 60 && !Landing.heard; frame++) rig.run(1 / 60);
    const heard = Landing.heard;
    if (!heard) throw new Error('The ball never heard itself land.');
    expect(heard.other).toBe(floor.entity.id);
    const { x, y, z } = heard.normal;
    expect(new Vector3(x, y, z).distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-6);
    expect(heard.impulse).toBeGreaterThan(10);

    // The kick acted at once, after the tick it landed in: a frame later the
    // ball rises at 20 N·s on 2 kg, less a tick of gravity.
    rig.run(1 / 60);
    expect(Math.abs(rig.body(ball.entity.id).linearVelocity.y - (10 - 9.81 / 60))).toBeLessThan(1e-3);
  });

  it("a script on a child hears its collider, and its body's script hears it too, once", async () => {
    const cart = withScript(withBody('box', [0, 3, 0], { lockRotation: [true, true, true] }), Log);
    const wheel = withScript(withCollider('sphere', [0, -1.5, 0]), Log);
    nest(cart, wheel);
    const floor = withScript(ground(), Log);
    const rig = await physicsRig([cart, wheel, floor]);

    rig.run(2);

    expect(heardBy(wheel)).toEqual([['onCollisionEnter', floor.entity.id]]);
    expect(heardBy(cart)).toEqual([['onCollisionEnter', floor.entity.id]]);
    expect(heardBy(floor)).toEqual([['onCollisionEnter', wheel.entity.id]]);
    // The floor's `this.physics` names the body the wheel moves with: its cart's.
    const fromFloor = logged.find(({ entity }) => entity === floor.entity.id);
    expect(fromFloor?.body).toBe(rig.body(cart.entity.id));
  });

  it("a script on the player hears the trigger it walks through, and the trigger's script hears the player", async () => {
    const walker = withScript(player([0, 1, 0]), Log);
    const zone = withScript(sensor([0, 1, -3], [2, 2, 2]), Log);
    const rig = await physicsRig([ground(), zone, walker]);

    rig.run(0.5);
    rig.press('KeyW');
    rig.run(1.5);

    expect(heardBy(walker)).toEqual([
      ['onTriggerEnter', zone.entity.id],
      ['onTriggerExit', zone.entity.id],
    ]);
    expect(heardBy(zone)).toEqual([
      ['onTriggerEnter', walker.entity.id],
      ['onTriggerExit', walker.entity.id],
    ]);
  });

  it('a hook that throws disables its script and says so', async () => {
    class Throws extends Behaviour {
      static exited = false;

      override onTriggerEnter() {
        throw new Error('the zone broke');
      }

      override onTriggerExit() {
        Throws.exited = true;
      }
    }
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    onTestFinished(() => error.mockRestore());
    const zone = withScript(sensor([0, 4, 0], [2, 2, 2]), Throws);
    const rig = await physicsRig([zone, withBody('sphere', [0, 7, 0]), ground()]);

    rig.run(3);

    expect(rig.engine.warnings.filter((line) => line.includes('failed in onTriggerEnter'))).toHaveLength(1);
    expect(Throws.exited).toBe(false);
  });

  it('a script listening on an entity with no Collider and no Rigid Body is told so, once', async () => {
    class Quiet extends Behaviour {}
    const rig = await physicsRig([withScript(createEntity('Door'), Log), withScript(createEntity('Lamp'), Quiet)]);

    rig.run(0.1);

    const door = rig.engine.warnings.filter((line) => line.includes('"Door"'));
    expect(door).toHaveLength(1);
    expect(door[0]).toContain('Collider');
    expect(rig.engine.warnings.filter((line) => line.includes('Lamp'))).toEqual([]);
  });

  it('with no physics, a listening script is quiet', async () => {
    // A host with no physics is about the host, not the scene: nothing to fix there.
    const engine = await Engine.create({
      scene: sceneWith([withScript(createEntity('Door'), Log)]),
      resolver: NULL_ASSET_RESOLVER,
      rendering: createRenderingSettings(),
      domElement: new EventTarget() as unknown as HTMLElement,
      enablePhysics: false,
    });
    onTestFinished(() => engine.dispose());

    expect(engine.warnings.filter((line) => line.includes('Door'))).toEqual([]);
  });
});
