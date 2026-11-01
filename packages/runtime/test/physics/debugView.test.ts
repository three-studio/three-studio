import { createJointMotion, createPhysicsSettings, createRenderingSettings } from '@three-studio/core';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { sceneWith } from '../../../core/test/fixtures';
import { Engine } from '../../src/Engine';
import { NULL_ASSET_RESOLVER } from '../../src/assets/AssetResolver';
import type { DebugLines } from '../../src/physics/PhysicsWorld';
import { ground, physicsRig, standInForTheBrowser, takeTheBrowserBack, withBody, withJoint } from './rig';

/*
 * Rapier's debug view, as a host reads it to draw over the running game: every
 * collider the solver holds, each body's axes and each joint, as of the last
 * tick.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

/** Two points of three floats each per line. */
const linesIn = (lines: DebugLines | null) => (lines?.vertices.length ?? 0) / 6;

/** The ground, a ball, and a 1 m box hinged to the world at (0, 2, 0). */
function scene() {
  const ball = withBody('sphere', [3, 2, 0]);
  const pendulum = withJoint(withBody('box', [1, 2, 0], { interpolate: false }), {
    anchor: [-1, 0, 0],
    motion: { ...createJointMotion('hinge'), axis: [0, 0, 1] },
  });
  return { ball, entities: [ground(), ball, pendulum] };
}

describe('the debug view', () => {
  it('draws every collider, each body’s axes and each joint the solver holds', async () => {
    const rig = await physicsRig(scene().entities);

    const lines = rig.engine.physicsDebug();

    // Measured: a box's 12 edges and a ball's 60 arcs, each with its body's
    // three axes — the ground's, the ball's, the pendulum's —, 3 for the hinge,
    // and the axes of the fixed body a joint with no Connected Body is held to.
    expect(linesIn(lines)).toBe(15 + 63 + 15 + 3 + 3);
    // Rapier's RGBA, four floats per point.
    expect(lines?.colors.length).toBe(((lines?.vertices.length ?? 0) / 3) * 4);
    expect(lines?.colors.every((channel) => channel >= 0 && channel <= 1)).toBe(true);
  });

  it('leaves out a body held out of the world', async () => {
    const { ball, entities } = scene();
    const rig = await physicsRig(entities);
    const before = linesIn(rig.engine.physicsDebug());

    rig.body(ball.entity.id).enabled = false;
    rig.run(1 / 60);

    // Its sphere and its axes: Rapier drew a disabled body where it was left.
    expect(linesIn(rig.engine.physicsDebug())).toBe(before - 63);
  });

  it('is read once per tick', async () => {
    const rig = await physicsRig(scene().entities);

    const first = rig.engine.physicsDebug();
    expect(rig.engine.physicsDebug()?.vertices).toBe(first?.vertices);

    rig.run(1 / 60);
    expect(rig.engine.physicsDebug()?.vertices).not.toBe(first?.vertices);
  });

  it('with physics off, there is nothing to draw', async () => {
    const engine = await Engine.create({
      scene: sceneWith(scene().entities),
      resolver: NULL_ASSET_RESOLVER,
      rendering: createRenderingSettings(),
      physicsSettings: createPhysicsSettings(),
      domElement: new EventTarget() as unknown as HTMLElement,
      enablePhysics: false,
    });
    onTestFinished(() => engine.dispose());

    expect(engine.physicsDebug()).toBeNull();
  });
});
