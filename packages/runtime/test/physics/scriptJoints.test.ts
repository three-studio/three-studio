import { createEntity, createJointMotion } from '@three-studio/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sceneWith } from '../../../core/test/fixtures';
import { Behaviour } from '../../src/scripting/ScriptHost';
import { scriptPhysicsFor } from '../../src/scripting/scriptPhysics';
import { physicsRig, standInForTheBrowser, takeTheBrowserBack, withBody, withJoint, withScript } from './rig';

/*
 * Scripts read a joint and drive its motor through `this.physics.joint`, by
 * the entity that carries it.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

/** Opens its own door with the joint's motor, and reads how far it has opened. */
class Opener extends Behaviour {
  static opened: number | null = null;

  override onStart() {
    const joint = this.physics.joint(this.entity.id);
    if (!joint) return;
    joint.motorSpeed = 2;
    joint.motorEnabled = true;
  }

  override onUpdate() {
    Opener.opened = this.physics.joint(this.entity.id)?.position ?? null;
  }
}

describe('a script and a joint', () => {
  it('a script opens a door with its motor, and reads it open', async () => {
    const motion = createJointMotion('hinge');
    const door = withScript(
      withJoint(withBody('box', [0.5, 1, 0]), {
        anchor: [-0.5, 0, 0],
        motion: { ...motion, limits: { enabled: true, min: 0, max: Math.PI / 2 } },
      }),
      Opener,
    );
    const rig = await physicsRig([door]);

    rig.run(1.5);

    expect(Math.abs((Opener.opened ?? 0) - Math.PI / 2)).toBeLessThan(0.01);
  });

  it('with no physics, `joint` finds nothing, quietly', () => {
    const said: string[] = [];
    const physics = scriptPhysicsFor(null, sceneWith([]), createEntity('Lone').entity, (line) => said.push(line));

    expect(physics.joint('anything')).toBeNull();
    expect(said).toEqual([]);
  });
});
