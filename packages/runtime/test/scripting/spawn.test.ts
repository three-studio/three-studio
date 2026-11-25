import { assertDefined, collectDescendants, createEntity, fixedId, type EntityId } from '@three-studio/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prefabWith } from '../../../core/test/fixtures';
import { physicsOf } from '../../src/physics/physicsOf';
import type { Entity } from '../../src/scripting/Entity';
import { Behaviour } from '../../src/scripting/ScriptHost';
import { worldScriptsOf, type WorldScripts } from '../../src/scripting/ScriptWorld';
import type { World } from '../../src/world/World';
import { builtInRegistries } from '../registries';
import { physicsRig, physicsRigOn, standInForTheBrowser, takeTheBrowserBack, withBody, withScript } from '../physics/rig';

/*
 * A script makes and unmakes entities through its world and their handles. A
 * spawn is drawn from the call, so the handle it gives has a container to move
 * at once; its body and scripts arrive at the frame's pass, built from where
 * the script left it. A destroyed entity is gone from every answer at once, and
 * its objects at the pass.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

function scriptsOf(world: World): WorldScripts {
  return assertDefined(worldScriptsOf(world), "the world's scripts");
}

/** The entities of a placement, and which of them physics holds a body for. */
function withBodies(world: World, root: EntityId): readonly EntityId[] {
  return [root, ...collectDescendants(world.document, root)].filter((id) => (physicsOf(world)?.body(id) ?? null) !== null);
}

describe('a script’s spawn', () => {
  it('gives a handle whose container is there at once, at its pose, under its parent’s', async () => {
    const holder = createEntity('Holder');
    holder.entity.transform.position = [0, 3, 0];
    const { world } = await physicsRig([holder]);
    const scripts = scriptsOf(world);
    const parent = assertDefined(scripts.entity(holder.entity.id), 'the holder');

    const spawned = assertDefined(scripts.spawn({ name: 'Spark', parent, position: { x: 1, y: 2, z: 0 } }), 'the spark');

    expect(spawned.name).toBe('Spark');
    expect(spawned.alive).toBe(true);
    expect(spawned.parent).toBe(parent);
    expect(spawned.object3D.parent).toBe(parent.object3D);
    expect(spawned.transform.position.toArray()).toEqual([1, 2, 0]);
    expect(scripts.entity(spawned.id)).toBe(spawned);
  });

  it('is given its body where the script moved it before the pass', async () => {
    const { world } = await physicsRig([]);
    const spawned = assertDefined(scriptsOf(world).spawn(), 'the spawn');
    spawned.addComponent('rigidbody');

    spawned.transform.position.set(0, 5, 0);
    world.frame(world.fixedStep);

    const body = assertDefined(physicsOf(world)?.body(spawned.id), 'its body');
    // One tick of falling from where it was put, not from the origin.
    expect(body.position.y).toBeGreaterThan(4.9);
    expect(body.position.y).toBeLessThanOrEqual(5);
  });
});

describe('a script’s instantiate', () => {
  it('gives the placement’s handle, its contents drawn at once, their bodies and scripts at the pass', async () => {
    const log: string[] = [];
    class Lifetime extends Behaviour {
      override onAwake() {
        log.push('awake');
      }

      override onStart() {
        log.push('start');
      }

      override onUpdate() {
        log.push('update');
      }
    }
    const crate = withScript(withBody('box', [0, 0, 0]), Lifetime);
    const CRATE = fixedId('asset', 'crate-prefab');
    const prefab = { ...prefabWith('Crate', [crate], crate.entity.id), id: CRATE };
    const rig = await physicsRigOn(builtInRegistries(), { prefabs: new Map([[CRATE, prefab]]), spawnable: [crate] })([]);
    const { world } = rig;

    const placed = assertDefined(scriptsOf(world).instantiate(CRATE, { position: { x: 0, y: 4, z: 0 } }), 'the placement');

    expect(placed.object3D.position.y).toBe(4);
    for (const id of collectDescendants(world.document, placed.id)) {
      expect(world.binder.getObject(id)).toBeDefined();
    }
    expect(withBodies(world, placed.id)).toEqual([]);
    expect(log).toEqual([]);

    world.frame(world.fixedStep);

    expect(withBodies(world, placed.id)).toHaveLength(1);
    expect(log).toEqual(['awake', 'start']);

    world.frame(world.fixedStep);

    expect(log).toEqual(['awake', 'start', 'update']);
  });
});

describe('an entity’s destroy', () => {
  it('is gone to every answer at once, its objects at the pass, its onDestroy once', async () => {
    let destroyed = 0;
    class Counted extends Behaviour {
      override onDestroy() {
        destroyed += 1;
      }
    }
    const crate = withScript(withBody('box', [0, 0, 0]), Counted);
    const { world } = await physicsRig([crate]);
    const scripts = scriptsOf(world);
    const entity = assertDefined(scripts.entity(crate.entity.id), 'the crate');

    entity.destroy();
    entity.destroy();

    expect(entity.alive).toBe(false);
    expect(entity.getComponent('rigidbody')).toBeNull();
    expect(scripts.entity(crate.entity.id)).toBeNull();
    expect(world.binder.getObject(crate.entity.id)).toBe(entity.object3D);
    expect(destroyed).toBe(0);

    world.frame(world.fixedStep);

    expect(world.binder.getObject(crate.entity.id)).toBeUndefined();
    expect(physicsOf(world)?.body(crate.entity.id)).toBeNull();
    expect(destroyed).toBe(1);
  });
});

describe('a spawn or a placement refused', () => {
  it('is none, and the script told once each: an unknown prefab, a parent gone, a parent that is no handle, a vector holding NaN', async () => {
    const gone = createEntity('Gone');
    const { world } = await physicsRig([gone]);
    const scripts = scriptsOf(world);
    const parent: Entity = assertDefined(scripts.entity(gone.entity.id), 'the parent');
    parent.destroy();
    world.warnings.length = 0;
    const count = world.document.entities.size;

    expect(scripts.instantiate('nope')).toBeNull();
    expect(scripts.spawn({ parent })).toBeNull();
    // What a script that is not typechecked might pass: the shape of a handle, no handle.
    expect(Reflect.apply(scripts.spawn, scripts, [{ parent: { id: gone.entity.id } }])).toBeNull();
    expect(scripts.spawn({ position: { x: Number.NaN, y: 0, z: 0 } })).toBeNull();

    expect(world.document.entities.size).toBe(count);
    expect(world.warnings).toEqual([
      'instantiate: "nope" is no prefab this game was given.',
      'spawn: its parent "Gone" is destroyed.',
      'spawn: its parent is no entity of this game.',
      'spawn: its position is no vector of three finite numbers.',
    ]);
  });
});
