import {
  Registry,
  createEntity,
  fixedId,
  type ScriptMembersId,
  type SubsystemId,
} from '@three-studio/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ScriptMembersDefinition, ScriptSite } from '../../src/scripting/members';
import { Behaviour } from '../../src/scripting/ScriptHost';
import type { SubsystemDefinition } from '../../src/world/World';
import { physicsRigOn, standInForTheBrowser, takeTheBrowserBack, withScript } from '../physics/rig';
import { builtInRegistries } from '../registries';

/*
 * What a script is given besides what the host gives it comes from
 * contributions: physics gives `body`, `physics` and the collision hooks,
 * audio gives `audio`, and a module would give its own the same way. Each
 * installs into every script before its `onAwake`, in the order it was
 * registered, its names reserved against the script's properties, and what it
 * holds of the script given back once the script is destroyed.
 */

beforeAll(standInForTheBrowser);
afterAll(takeTheBrowserBack);

/** A contribution that gives a member named after its id, the script's entity's name, and writes what it does into `log`. */
function probe(id: ScriptMembersId, log: string[]): ScriptMembersDefinition {
  const name: string = id;
  return {
    id,
    members: { [name]: `    readonly ${name}: string;` },
    types: '',
    install(site: ScriptSite) {
      const given = Reflect.has(site.script, 'body') && Reflect.has(site.script, 'audio');
      log.push(`${name} installed on ${site.entity.name}${given ? ', after physics and audio' : ''}`);
      Object.assign(site.script, { [name]: site.entity.name });
      return { dispose: () => void log.push(`${name} given back by ${site.entity.name}`) };
    },
  };
}

describe('a contribution to scripts', () => {
  it('gives every script its members before `onAwake`, the kernel’s among them', async () => {
    const log: string[] = [];
    const registries = builtInRegistries();
    registries.scriptMembers.register(probe(fixedId('scriptMembers', 'probe'), log));
    const seen: string[] = [];
    class Reads extends Behaviour {
      override onAwake() {
        seen.push(`${this.entity.name}: ${String(Reflect.get(this, 'probe'))}`);
        seen.push(`${typeof this.body.applyImpulse} ${typeof this.physics.raycast} ${typeof this.audio.play}`);
      }
    }

    await physicsRigOn(registries)([withScript(createEntity('Left'), Reads), withScript(createEntity('Right'), Reads)]);

    expect(seen).toEqual(['Left: Left', 'function function function', 'Right: Right', 'function function function']);
  });

  it('installs in the order it was registered, after those the runtime registers', async () => {
    const log: string[] = [];
    const registries = builtInRegistries();
    registries.scriptMembers.register(probe(fixedId('scriptMembers', 'first'), log));
    registries.scriptMembers.register(probe(fixedId('scriptMembers', 'second'), log));

    await physicsRigOn(registries)([withScript(createEntity('Holder'), class extends Behaviour {})]);

    expect(log).toEqual([
      'first installed on Holder, after physics and audio',
      'second installed on Holder, after physics and audio',
    ]);
  });

  it('reserves its names, as the kernel’s are: a script property called one is refused and said', async () => {
    const registries = builtInRegistries();
    registries.scriptMembers.register(probe(fixedId('scriptMembers', 'probe'), []));
    const kept: unknown[] = [];
    class Declares extends Behaviour {
      static override properties = {
        probe: { type: 'number', default: 1 },
        transform: { type: 'number', default: 1 },
        speed: { type: 'number', default: 1 },
      } as const;

      override onAwake() {
        kept.push(Reflect.get(this, 'speed'), typeof this.transform.position);
      }
    }
    const holder = withScript(createEntity('Holder'), Declares, { probe: 5, transform: 2, speed: 3 });

    const { world } = await physicsRigOn(registries)([holder]);

    expect(kept).toEqual([3, 'object']);
    expect(world.warnings).toContain('"Holder": script property "probe" is a reserved name and was ignored.');
    expect(world.warnings).toContain('"Holder": script property "transform" is a reserved name and was ignored.');
  });

  it('gives back what it installed once the script is destroyed, after its `onDestroy`', async () => {
    const log: string[] = [];
    const registries = builtInRegistries();
    registries.scriptMembers.register(probe(fixedId('scriptMembers', 'probe'), log));
    class Leaves extends Behaviour {
      override onDestroy() {
        log.push(`${this.entity.name} destroyed`);
      }
    }
    const holder = withScript(createEntity('Holder'), Leaves);
    const rig = await physicsRigOn(registries)([holder]);
    log.length = 0;

    rig.world.destroy(holder.entity.id);
    rig.world.frame(rig.world.fixedStep);

    expect(log).toEqual(['Holder destroyed', 'probe given back by Holder']);
  });

  it('is refused under an id already registered', () => {
    const registries = builtInRegistries();

    expect(() => registries.scriptMembers.register(probe(fixedId('scriptMembers', 'physics'), []))).toThrow(
      /already registered/,
    );
  });
});

describe('a world with no scripts subsystem', () => {
  it('runs no script, and says so', async () => {
    const registries = builtInRegistries();
    const subsystems = new Registry<SubsystemId, SubsystemDefinition>('subsystem');
    for (const subsystem of registries.subsystems.values()) {
      if (subsystem.id !== fixedId('subsystem', 'scripts')) subsystems.register(subsystem);
    }
    const woke: string[] = [];
    class Wakes extends Behaviour {
      override onAwake() {
        woke.push(this.entity.name);
      }
    }

    const { world } = await physicsRigOn({ ...registries, subsystems })([withScript(createEntity('Holder'), Wakes)]);

    expect(woke).toEqual([]);
    expect(world.warnings).toContain('"Holder" has a script, and this world runs none: it has no scripts subsystem.');
  });
});
