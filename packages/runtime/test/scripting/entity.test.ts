import { assertDefined, createEntity, type EntityId } from '@three-studio/core';
import { Quaternion, Vector3, type Object3D } from 'three/webgpu';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Entity } from '../../src/scripting/Entity';
import { Behaviour } from '../../src/scripting/ScriptHost';
import { worldScriptsOf } from '../../src/scripting/ScriptWorld';
import type { World } from '../../src/world/World';
import { nest, physicsRig, standInForTheBrowser, takeTheBrowserBack, withBody, withScript } from '../physics/rig';

/*
 * A script reaches entities through handles: one per entity per world, the
 * same each time it is asked for, its transform the drawing's own vectors. A
 * handle reads the running world's document, so an entity destroyed is gone
 * from it at once, and nothing a script holds is the document itself.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

/** The handle `world` gives for `id`, asserted there. */
function handle(world: World, id: EntityId): Entity {
  return assertDefined(worldScriptsOf(world)?.entity(id), `the handle of ${id}`);
}

describe('an entity’s handle', () => {
  it('is one per entity per world: the same each time, another in another world', async () => {
    const crate = createEntity('Crate');
    const one = await physicsRig([crate]);
    const two = await physicsRig([crate]);

    const first = handle(one.world, crate.entity.id);

    expect(first).toBeInstanceOf(Entity);
    expect(handle(one.world, crate.entity.id)).toBe(first);
    expect(handle(two.world, crate.entity.id)).not.toBe(first);
    expect(first.object3D).toBe(one.world.binder.getObject(crate.entity.id));
  });

  it('is none for text that is no id, an id the world does not hold, and an entity destroyed this frame', async () => {
    const crate = createEntity('Crate');
    const { world } = await physicsRig([crate]);
    const scripts = assertDefined(worldScriptsOf(world), "the world's scripts");
    const held = handle(world, crate.entity.id);

    expect(scripts.entity('')).toBeNull();
    expect(scripts.entity('nobody')).toBeNull();

    world.destroy(crate.entity.id);

    expect(scripts.entity(crate.entity.id)).toBeNull();
    // The handle a script kept says so from the call, its name still there to log.
    expect([held.alive, held.parent, held.name]).toEqual([false, null, 'Crate']);
  });

  it('is what a script is given as its entity, before `onAwake`: its name, its parent, its container', async () => {
    const seen: unknown[] = [];
    let object: Object3D | null = null;
    class Reads extends Behaviour {
      override onAwake() {
        seen.push(
          this.entity === this.world.entity(this.entity.id),
          this.transform === this.entity.transform,
          this.entity.name,
          this.entity.parent?.name ?? null,
          this.entity.alive,
        );
        object = this.entity.object3D;
      }
    }
    const holder = createEntity('Holder');
    const child = withScript(createEntity('Child'), Reads);
    const top = withScript(createEntity('Top'), Reads);
    const { world } = await physicsRig([nest(holder, child), child, top]);

    expect(seen).toEqual([true, true, 'Child', 'Holder', true, true, true, 'Top', null, true]);
    expect(object).toBe(world.binder.getObject(top.entity.id));
    expect(handle(world, child.entity.id).parent).toBe(handle(world, holder.entity.id));
  });

  it('refuses a script property named `world`, the world a script is given', async () => {
    class Declares extends Behaviour {
      static override properties = { world: { type: 'number', default: 1 } } as const;
    }

    const { world } = await physicsRig([withScript(createEntity('Holder'), Declares, { world: 2 })]);

    expect(world.warnings).toContain('"Holder": script property "world" is a reserved name and was ignored.');
  });
});

describe('an entity’s transform', () => {
  it('is the drawing’s own vectors: a write moves the object, and a dynamic body is put there keeping its speed', async () => {
    class Moves extends Behaviour {
      static same = false;
      override onAwake() {
        const object = this.entity.object3D;
        Moves.same =
          this.transform.position === object.position &&
          this.transform.rotation === object.rotation &&
          this.transform.quaternion === object.quaternion &&
          this.transform.scale === object.scale;
      }

      override onUpdate() {
        if (this.time > 0.1 && this.transform.position.x < 4) this.transform.position.set(5, 5, 0);
      }
    }
    const ball = withScript(withBody('sphere', [0, 5, 0], { gravityScale: 0, interpolate: false }), Moves);
    const rig = await physicsRig([ball]);
    rig.body(ball.entity.id).linearVelocity = { x: 2, y: 0, z: 0 };

    rig.run(0.25);

    expect(Moves.same).toBe(true);
    const { position } = rig.solved(ball.entity.id);
    expect(position.y).toBeCloseTo(5, 6);
    expect(position.x).toBeGreaterThan(5);
    expect(position.x).toBeLessThan(5.3);
    expect(rig.body(ball.entity.id).linearVelocity.x).toBeCloseTo(2, 6);
  });

  it('reads where it is in the world into the target it is handed, its parent moved and turned', async () => {
    const parent = createEntity('Parent');
    parent.entity.transform.position = [1, 0, 0];
    const child = createEntity('Child');
    child.entity.transform.position = [0, 2, 0];
    const { world } = await physicsRig([nest(parent, child), child]);
    const target = { x: 0, y: 0, z: 0 };

    expect(handle(world, child.entity.id).transform.getWorldPosition(target)).toBe(target);
    expect(target).toEqual({ x: 1, y: 2, z: 0 });

    const moved = handle(world, parent.entity.id).transform;
    moved.position.x = 4;
    moved.rotation.z = Math.PI / 2;
    handle(world, child.entity.id).transform.getWorldPosition(target);

    expect(new Vector3(target.x, target.y, target.z).distanceTo(new Vector3(2, 0, 0))).toBeLessThan(1e-9);
  });

  it('turns its +Z to face a point, and says which way that is and how it is turned', async () => {
    const turret = createEntity('Turret');
    turret.entity.transform.position = [1, 0, 1];
    const { world } = await physicsRig([turret]);
    const { transform } = handle(world, turret.entity.id);

    transform.lookAt({ x: 4, y: 0, z: 1 });

    const direction = transform.getWorldDirection({ x: 0, y: 0, z: 0 });
    expect(new Vector3(direction.x, direction.y, direction.z).distanceTo(new Vector3(1, 0, 0))).toBeLessThan(1e-9);
    const turned = transform.getWorldQuaternion({ x: 0, y: 0, z: 0, w: 1 });
    // A quarter turn about y: what takes +Z to +X.
    const quarter = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    expect(new Quaternion(turned.x, turned.y, turned.z, turned.w).angleTo(quarter)).toBeLessThan(1e-6);
  });
});
