import { fixedId, type Registry, type ScriptMembersId } from '@three-studio/core';
import type { SubsystemDefinition, World } from '../world/World';
import type { ScriptMembersDefinition } from './members';
import { reservedScriptNames } from './typings';

/**
 * What a world's scripts share: the contributions installed into each, and the
 * names those reserve with the kernel's. Made once per world by its scripts
 * subsystem, and reached by `scriptWorldOf`.
 */
export class ScriptWorld {
  /** Every name a script property may not take, each contribution's included. */
  readonly reserved: ReadonlySet<string>;

  constructor(
    /** In registration order, which is the order each script has them installed in. */
    readonly contributions: readonly ScriptMembersDefinition[],
  ) {
    this.reserved = reservedScriptNames(contributions);
  }
}

/*
 * Each world's scripts, keyed by the world, as `inputOf` is and for the same
 * reasons.
 */
const scriptWorlds = new WeakMap<World, ScriptWorld>();

/** What a world's scripts share: `null` in a world whose registries leave the scripts subsystem out. */
export function scriptWorldOf(world: World): ScriptWorld | null {
  return scriptWorlds.get(world) ?? null;
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
      scriptWorlds.set(world, new ScriptWorld(registry.values()));
      return { dispose: () => void scriptWorlds.delete(world) };
    },
  };
}
