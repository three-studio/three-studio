import type { Disposable, EntityDoc, ScriptMembersId } from '@three-studio/core';
import type { World } from '../world/World';
import type { Behaviour } from './ScriptApi';

/**
 * What a feature gives every script: physics' body and collision hooks,
 * audio's mix, one day a module's own.
 *
 * Registered in the runtime's `scriptMembers` by whoever contributes, and
 * installed by the script host into each script before its `onAwake`, in
 * registration order, so the host names none of them. Its members are typed
 * on `Behaviour` by the contributor's augmentation of `ScriptMembers`, their
 * names are reserved against a script's properties, and its lines are part of
 * a project's script typings.
 */
export interface ScriptMembersDefinition {
  readonly id: ScriptMembersId;
  /**
   * Each member it gives, or hook it calls, with its lines of the published
   * `Behaviour`: indented four spaces, as a member of the class is, a line
   * that opens on a newline leaving a blank one before it. Its keys are the
   * names it reserves.
   */
  readonly members: Readonly<Record<string, string>>;
  /** The declarations its lines name, as published text, indented two spaces, blank lines between them. */
  readonly types: string;
  /** Gives one script its members. What it returns is disposed with the script, after its `onDestroy`. */
  install(site: ScriptSite): Disposable;
}

/** One script, as a contribution installs into it. */
export interface ScriptSite {
  readonly script: Behaviour;
  /** The entity it runs on. */
  readonly entity: EntityDoc;
  /** The world it runs in: its document, its features' accessors, `warn`. */
  readonly world: World;
  /**
   * Calls one of the script's hooks as the host calls its own: not once the
   * script has failed, and a throw disables it, said once with the hook named.
   */
  run<A>(hook: string, call: ((this: Behaviour, arg: A) => void) | undefined, arg: A): void;
}
