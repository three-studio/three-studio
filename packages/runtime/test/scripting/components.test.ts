import {
  assertDefined,
  createCameraEntity,
  createEntity,
  createLightEntity,
  createMeshEntity,
  findComponent,
  type EntityId,
} from '@three-studio/core';
import { Light, type Object3D } from 'three/webgpu';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { physicsOf } from '../../src/physics/physicsOf';
import type { Entity } from '../../src/scripting/Entity';
import { worldScriptsOf } from '../../src/scripting/ScriptWorld';
import type { World } from '../../src/world/World';
import { physicsRig, standInForTheBrowser, takeTheBrowserBack } from '../physics/rig';

/*
 * A script reads a component of the running world's document, frozen, and
 * writes one whole: what it hands over is decoded, as a file is, and goes in
 * through the world's own calls, so the frame's pass mounts and patches it as
 * it does any change. Nothing a script holds is a door into the document.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

function handle(world: World, id: EntityId): Entity {
  return assertDefined(worldScriptsOf(world)?.entity(id), `the handle of ${id}`);
}

/** The three light a light component is drawn as, under the entity's container; `null` once it is gone. */
function lightUnder(object: Object3D): Light | null {
  const found = object.getObjectsByProperty('isLight', true)[0];
  return found instanceof Light ? found : null;
}

function named<T extends { entity: { name: string } }>(template: T, name: string): T {
  template.entity.name = name;
  return template;
}

/**
 * A running world of these entities, its scene's own diagnostics — no camera,
 * no light — set aside: what it warns of after is the script's.
 */
async function running(templates: Parameters<typeof physicsRig>[0]): Promise<World> {
  const { world } = await physicsRig(templates);
  world.warnings.length = 0;
  return world;
}

describe('a component, through an entity’s handle', () => {
  it('is read as the running document holds it, frozen all through, and is none where the entity holds none', async () => {
    const lamp = createLightEntity('point');
    const bare = createEntity('Bare');
    const { world } = await physicsRig([lamp, bare]);

    const light = assertDefined(handle(world, lamp.entity.id).getComponent('light'), 'the light');

    expect(light).toBe(findComponent(world.document, lamp.entity.id, 'light'));
    expect(Object.isFrozen(light)).toBe(true);
    expect(Object.isFrozen(light.shadow)).toBe(true);
    expect(() => Object.assign(light, { intensity: 9 })).toThrow(TypeError);
    expect(handle(world, bare.entity.id).getComponent('light')).toBeNull();
  });

  it('is written whole, and the drawing takes it at the frame’s pass', async () => {
    const lamp = createLightEntity('point');
    const world = await running([lamp]);
    const entity = handle(world, lamp.entity.id);
    const light = assertDefined(entity.getComponent('light'), 'the light');

    expect(entity.setComponent({ ...light, intensity: 3 })).toBe(true);
    expect(lightUnder(entity.object3D)?.intensity).toBe(light.intensity);

    world.frame(world.fixedStep);

    expect(lightUnder(entity.object3D)?.intensity).toBe(3);
    expect(entity.getComponent('light')?.intensity).toBe(3);
    expect(Object.isFrozen(entity.getComponent('light'))).toBe(true);
    expect(world.warnings).toEqual([]);
  });

  it('is refused, and the script told, when its type is none this build defines, the entity holds none under its id, or a field does not read', async () => {
    const lamp = named(createLightEntity('point'), 'Lamp');
    const world = await running([lamp]);
    const entity = handle(world, lamp.entity.id);
    const light = assertDefined(entity.getComponent('light'), 'the light');
    const stranger = createLightEntity('spot').components[0];

    expect(entity.setComponent({ ...light, type: 'acme.glow' })).toBe(false);
    expect(entity.setComponent({ ...light, id: stranger?.id })).toBe(false);
    expect(entity.setComponent({ ...light, intensity: 'bright' })).toBe(false);
    expect(entity.setComponent('light')).toBe(false);

    expect(entity.getComponent('light')).toBe(light);
    expect(world.warnings).toEqual([
      '"Lamp": setComponent was handed a component of type "acme.glow", which this build does not define.',
      `"Lamp": setComponent was handed a light under the id "${stranger?.id}", which the entity does not hold: addComponent adds one.`,
      expect.stringMatching(/^"Lamp": setComponent was handed a light that does not read\nintensity: /),
      '"Lamp": setComponent was handed no component.',
    ]);
  });

  it('is added with what its type requires, which the frame’s pass builds', async () => {
    const crate = createMeshEntity('box');
    const { world } = await physicsRig([crate]);
    const entity = handle(world, crate.entity.id);

    const body = entity.addComponent('rigidbody');

    expect(body?.type).toBe('rigidbody');
    expect(Object.isFrozen(body)).toBe(true);
    expect(body).toBe(entity.getComponent('rigidbody'));
    expect(entity.getComponent('collider')).not.toBeNull();
    expect(physicsOf(world)?.body(crate.entity.id)).toBeNull();

    world.frame(world.fixedStep);

    expect(physicsOf(world)?.body(crate.entity.id)).not.toBeNull();
  });

  it('is not added beside what refuses it, and the script told', async () => {
    const eye = named(createCameraEntity(), 'Eye');
    const world = await running([eye]);
    const entity = handle(world, eye.entity.id);
    const camera = entity.getComponent('camera');

    expect(entity.addComponent('camera')).toBeNull();

    expect(entity.getComponent('camera')).toBe(camera);
    expect(world.warnings).toEqual(['"Eye": addComponent("camera") added nothing: it does not fit beside what the entity holds.']);
  });

  it('is taken off, and its drawing at the frame’s pass', async () => {
    const lamp = createLightEntity('point');
    const { world } = await physicsRig([lamp]);
    const entity = handle(world, lamp.entity.id);
    const light = assertDefined(entity.getComponent('light'), 'the light');

    expect(entity.removeComponent(light)).toBe(true);
    expect(entity.removeComponent(light)).toBe(false);
    expect(entity.getComponent('light')).toBeNull();
    expect(lightUnder(entity.object3D)).not.toBeNull();

    world.frame(world.fixedStep);

    expect(lightUnder(entity.object3D)).toBeNull();
  });

  it('is none to read and none to write on an entity destroyed this frame', async () => {
    const lamp = createLightEntity('point');
    const world = await running([lamp]);
    const entity = handle(world, lamp.entity.id);
    const light = assertDefined(entity.getComponent('light'), 'the light');

    world.destroy(lamp.entity.id);

    expect(entity.getComponent('light')).toBeNull();
    expect(entity.setComponent({ ...light, intensity: 3 })).toBe(false);
    expect(entity.addComponent('rigidbody')).toBeNull();
    expect(entity.removeComponent(light)).toBe(false);
    expect(world.warnings).toEqual([]);
  });
});
