import {
  createPhysicsMaterial,
  createPhysicsSettings,
  createRenderingSettings,
  type CombineRule,
  type EntityTemplate,
  type PhysicsMaterialDef,
} from '@three-studio/core';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { sceneWith } from '../../../core/test/fixtures';
import { Engine } from '../../src/Engine';
import { NULL_ASSET_RESOLVER } from '../../src/assets/AssetResolver';
import {
  colliderOf,
  ground,
  physicsRig,
  standInForTheBrowser,
  takeTheBrowserBack,
  withBody,
} from './rig';

/*
 * A collider linked to a physics material asset is built with the asset's
 * values, its own kept for when it unlinks. The set-ups are the ones that
 * showed each combine rule on a collider's own material: here the collider's
 * own values say the opposite of what the asset it links says.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

const LIBRARY: Record<string, PhysicsMaterialDef> = {
  grip: { ...createPhysicsMaterial(), friction: 1, frictionCombine: 'max' },
  ice: { ...createPhysicsMaterial(), friction: 0, frictionCombine: 'min' },
  rubber: { ...createPhysicsMaterial(), restitution: 1, restitutionCombine: 'max' },
  dead: { ...createPhysicsMaterial(), restitution: 0, restitutionCombine: 'min' },
};

/** A box on the slope, of its own friction 1 by this rule, linking this asset. */
function boxOnSlope(frictionCombine: CombineRule, z: number, materialId: string): EntityTemplate {
  const box = withBody('box', [0, 1, z], { lockRotation: [true, true, true] });
  const collider = colliderOf(box);
  collider.material = { ...collider.material, friction: 1, frictionCombine };
  collider.materialId = materialId;
  return box;
}

/** A 30° slope whose own friction, 0.2, holds nothing: tan 30° is 0.58. */
function slope(): EntityTemplate {
  const template = ground(30);
  colliderOf(template).material = { ...colliderOf(template).material, friction: 0.2 };
  return template;
}

describe('a collider linked to a physics material', () => {
  it('a box grips or slides by the physics material it links, whatever its own values say', async () => {
    // Alone, Minimum slides and Maximum holds.
    const held = boxOnSlope('min', 1.5, 'grip');
    const slid = boxOnSlope('max', -1.5, 'ice');
    const rig = await physicsRig([slope(), held, slid], undefined, LIBRARY);

    rig.run(0.5);
    const landed = {
      held: rig.solved(held.entity.id).position,
      slid: rig.solved(slid.entity.id).position,
    };
    rig.run(1);

    expect(rig.solved(held.entity.id).position.distanceTo(landed.held)).toBeLessThan(0.01);
    expect(rig.solved(slid.entity.id).position.distanceTo(landed.slid)).toBeGreaterThan(0.5);
  });

  it('a ball bounces by the physics material it links', async () => {
    const peakAfterLanding = async (restitutionCombine: CombineRule, materialId: string) => {
      const ball = withBody('sphere', [0, 2.5, 0]);
      const collider = colliderOf(ball);
      collider.material = { ...collider.material, restitution: 1, restitutionCombine };
      collider.materialId = materialId;
      const rig = await physicsRig([ground(), ball], undefined, LIBRARY);
      const heights: number[] = [];
      for (let tick = 0; tick < 100; tick++) {
        rig.run(1 / 60);
        heights.push(rig.solved(ball.entity.id).position.y);
      }
      // Its first contact is the lowest it gets before it rises again, if it does.
      const contact = heights.findIndex((height, i) => i > 0 && height >= (heights[i - 1] ?? height));
      return Math.max(...heights.slice(contact === -1 ? heights.length - 1 : contact));
    };

    // Alone, Minimum gives back nothing and Maximum all of it.
    expect(await peakAfterLanding('min', 'rubber')).toBeGreaterThan(2);
    expect(await peakAfterLanding('max', 'dead')).toBeLessThan(0.6);
  });

  it('a collider whose physics material is not in the project uses its own values, and says so once', async () => {
    const puck = boxOnSlope('max', 0, 'gone');
    puck.entity.name = 'Puck';
    const rig = await physicsRig([slope(), puck], undefined, LIBRARY);

    rig.run(0.5);
    const landed = rig.solved(puck.entity.id).position;
    rig.run(1);

    expect(rig.solved(puck.entity.id).position.distanceTo(landed)).toBeLessThan(0.01);
    const said = rig.engine.warnings.filter((line) => line.includes('"Puck"'));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('physics material');

    // With physics off the line would be about the host, not the scene.
    const off = await Engine.create({
      scene: sceneWith([slope(), boxOnSlope('max', 0, 'gone')]),
      resolver: NULL_ASSET_RESOLVER,
      rendering: createRenderingSettings(),
      physicsSettings: createPhysicsSettings(),
      physicsMaterials: LIBRARY,
      domElement: new EventTarget() as unknown as HTMLElement,
      enablePhysics: false,
    });
    onTestFinished(() => off.dispose());
    expect(off.warnings.filter((line) => line.includes('physics material'))).toEqual([]);
  });
});
