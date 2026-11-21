import {
  fixedId,
  isEntityId,
  type EntityDoc,
  type Registry,
  type ScriptMembersId,
} from '@three-studio/core';
import type { Object3D } from 'three/webgpu';
import type { SubsystemDefinition, World } from '../world/World';
import { Entity, type ScriptWorld } from './Entity';
import type { ScriptMembersDefinition } from './members';
import { reservedScriptNames } from './typings';

/**
 * What a world's scripts share: the handles of its entities, the contributions
 * installed into each script, and the names those reserve with the kernel's.
 * Made once per world by its scripts subsystem, reached by `worldScriptsOf`,
 * and given to each of its scripts as `this.world`.
 */
export class WorldScripts implements ScriptWorld {
  /** Every name a script property may not take, each contribution's included. */
  readonly reserved: ReadonlySet<string>;
  /**
   * Each entity's handle, by its container: a handle lives as long as the
   * drawing does, so a churn of spawns leaves nothing behind here, and nothing
   * has to be told when an entity goes.
   */
  private readonly handles = new WeakMap<Object3D, Entity>();

  constructor(
    private readonly world: World,
    /** In registration order, which is the order each script has them installed in. */
    readonly contributions: readonly ScriptMembersDefinition[],
  ) {
    this.reserved = reservedScriptNames(contributions);
  }

  entity(id: string): Entity | null {
    if (!isEntityId(id)) return null;
    const record = this.world.document.entities.get(id);
    const object = this.world.binder.getObject(id);
    return record === undefined || object === undefined ? null : this.handle(record, object);
  }

  /** The handle of the entity with this record and this container: made the first time, the same after. */
  handle(record: EntityDoc, object: Object3D): Entity {
    const known = this.handles.get(object);
    if (known !== undefined) return known;
    const made = new Entity(record.id, record, object, this.world, this);
    this.handles.set(object, made);
    return made;
  }
}

/*
 * Each world's scripts, keyed by the world, as `inputOf` is and for the same
 * reasons.
 */
const worlds = new WeakMap<World, WorldScripts>();

/** What a world's scripts share: `null` in a world whose registries leave the scripts subsystem out. */
export function worldScriptsOf(world: World): WorldScripts | null {
  return worlds.get(world) ?? null;
}

/**
 * The scripts of a world in Play: what they share, made from the contributions
 * registered when the world is made — after every activation, so a module's
 * are there beside the kernel's, which made this definition.
 *
 * Registered before the behaviours, which make the scripts and read this as
 * each is made; and so taken down after them, a script's `onDestroy` running
 * while what it shares is still its world's.
 */
export function scriptsSubsystem(registry: Registry<ScriptMembersId, ScriptMembersDefinition>): SubsystemDefinition {
  return {
    id: fixedId('subsystem', 'scripts'),
    create(world) {
      worlds.set(world, new WorldScripts(world, registry.values()));
      return { dispose: () => void worlds.delete(world) };
    },
  };
}
