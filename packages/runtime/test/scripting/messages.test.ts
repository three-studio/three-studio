import {
  assertDefined,
  collectDescendants,
  createEntity,
  findComponent,
  fixedId,
  type EntityTemplate,
} from '@three-studio/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prefabWith } from '../../../core/test/fixtures';
import type { Message } from '../../src/scripting/Entity';
import { Behaviour } from '../../src/scripting/ScriptHost';
import { worldScriptsOf, type WorldScripts } from '../../src/scripting/ScriptWorld';
import type { World } from '../../src/world/World';
import { physicsRig, physicsRigOn, standInForTheBrowser, takeTheBrowserBack, withScript } from '../physics/rig';
import { builtInRegistries } from '../registries';

/*
 * An entity is sent a message by its handle and hears it at the start of the
 * next frame, before any `onUpdate`: in send order, by each of its scripts that
 * defines `onMessage`, in the order they were made. No handler runs inside
 * another, and a spawn hears what was sent to it in its spawn frame, once its
 * scripts have started.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

function scriptsOf(world: World): WorldScripts {
  return assertDefined(worldScriptsOf(world), "the world's scripts");
}

/** A script that writes what it hears, and its updates, into `log` under `label`. */
function listener(log: string[], label: string) {
  return class extends Behaviour {
    override onStart() {
      log.push(`${label} start`);
    }

    override onUpdate() {
      log.push(`${label} update`);
    }

    override onMessage({ name, payload }: Message) {
      log.push(`${label} heard ${name}${payload === undefined ? '' : ` ${String(payload)}`}`);
    }
  };
}

/** A script that hears nothing. */
class Deaf extends Behaviour {}

function named(name: string, ...scripts: Parameters<typeof withScript>[1][]): EntityTemplate {
  const template = createEntity(name);
  for (const script of scripts) withScript(template, script);
  return template;
}

describe('a message', () => {
  it('is heard at the next frame, before any update, in send order, by each listening script in creation order', async () => {
    const log: string[] = [];
    const door = named('Door', listener(log, 'a'), Deaf, listener(log, 'b'));
    const { world } = await physicsRig([door]);
    const handle = assertDefined(scriptsOf(world).entity(door.entity.id), 'the door');
    log.length = 0;

    handle.send('open', 1);
    handle.send('close');
    expect(log).toEqual([]);

    world.frame(world.fixedStep);

    expect(log).toEqual(['a heard open 1', 'b heard open 1', 'a heard close', 'b heard close', 'a update', 'b update']);
  });

  it('is dropped when its entity is destroyed before it is delivered, and when sent to one already gone', async () => {
    const log: string[] = [];
    const door = named('Door', listener(log, 'door'));
    const { world } = await physicsRig([door]);
    const handle = assertDefined(scriptsOf(world).entity(door.entity.id), 'the door');
    log.length = 0;

    handle.send('open');
    handle.destroy();
    handle.send('late');
    world.frame(world.fixedStep);
    world.frame(world.fixedStep);

    // Its scripts finish the frame they were destroyed in, and hear nothing.
    expect(log).toEqual(['door update']);
  });

  it('sent while messages are delivered is heard at the frame after', async () => {
    const log: string[] = [];
    class Echo extends Behaviour {
      override onMessage({ name }: Message) {
        log.push(`heard ${name}`);
        if (name === 'ping') this.entity.send('pong');
      }
    }
    const echo = named('Echo', Echo);
    const { world } = await physicsRig([echo]);
    const handle = assertDefined(scriptsOf(world).entity(echo.entity.id), 'the echo');

    handle.send('ping');
    world.frame(world.fixedStep);
    expect(log).toEqual(['heard ping']);

    world.frame(world.fixedStep);
    expect(log).toEqual(['heard ping', 'heard pong']);
  });

  it('sent to a spawn in its spawn frame is heard after the spawn’s scripts start', async () => {
    const log: string[] = [];
    const crate = named('Crate', listener(log, 'crate'));
    const CRATE = fixedId('asset', 'crate-prefab');
    const prefab = { ...prefabWith('Crate', [crate], crate.entity.id), id: CRATE };
    // Spawns once from its `onUpdate`, after the frame's delivery, and sends
    // at once to the crate the placement holds: its scripts start at the pass.
    class Spawner extends Behaviour {
      private spawned = false;

      override onUpdate() {
        if (this.spawned) return;
        this.spawned = true;
        const placed = assertDefined(this.world.instantiate(CRATE), 'the placement');
        const scripted = [placed.id, ...collectDescendants(world.document, placed.id)].find(
          (id) => findComponent(world.document, id, 'script') !== undefined,
        );
        this.world.entity(assertDefined(scripted, 'the scripted crate'))?.send('hello');
      }
    }
    const spawner = named('Spawner', Spawner);
    const { world } = await physicsRigOn(builtInRegistries(), { prefabs: new Map([[CRATE, prefab]]), spawnable: [crate] })([
      spawner,
    ]);

    world.frame(world.fixedStep);
    world.frame(world.fixedStep);

    expect(log).toEqual(['crate start', 'crate heard hello', 'crate update']);
  });

  it('that throws disables only the script that threw, said once, and a destroyed script stops listening', async () => {
    const log: string[] = [];
    class Throws extends Behaviour {
      override onMessage() {
        log.push('threw');
        throw new Error('boom');
      }
    }
    const door = named('Door', Throws, listener(log, 'other'));
    const { world } = await physicsRig([door]);
    const scripts = scriptsOf(world);
    const handle = assertDefined(scripts.entity(door.entity.id), 'the door');
    world.warnings.length = 0;
    log.length = 0;

    handle.send('a');
    handle.send('b');
    world.frame(world.fixedStep);

    expect(log.filter((line) => line !== 'other update')).toEqual(['threw', 'other heard a', 'other heard b']);
    expect(world.warnings).toEqual([expect.stringMatching(/^Door\/Throws failed in onMessage: boom$/)]);
    expect(scripts.messages.listenedEntities()).toEqual([door.entity.id]);

    handle.destroy();
    world.frame(world.fixedStep);

    expect(scripts.messages.listenedEntities()).toEqual([]);
  });
});
