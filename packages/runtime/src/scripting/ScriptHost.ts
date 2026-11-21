import { combineDisposables, type Disposable } from '@three-studio/core';
import type {
  Behaviour as RuntimeBehaviour,
  BehaviourDefinition,
  BehaviourTarget,
} from '../behaviour/Behaviour';
import { inputOf } from '../input/inputOf';
import type { EntityChannel } from '../world/channel';
import type { World } from '../world/World';
import type { Entity, Message } from './Entity';
import type { ScriptMembersDefinition, ScriptSite } from './members';
import { isScriptClass } from './scriptBundle';
import { Behaviour } from './ScriptApi';
import { worldScriptsOf } from './ScriptWorld';

/**
 * Adapts a user script to the runtime's behaviour interface.
 *
 * Errors are caught per phase and reported once rather than per frame: a script
 * that throws every tick would otherwise bury the console and take the whole
 * game down with it. A failed script is disabled and named, which is what makes
 * the problem findable.
 *
 * Each hook calls the script inside a `try` of its own. They went through
 * `guard(phase, () => …)`, which made a closure per script per hook per frame.
 *
 * It is also the site each contribution installs into: what a feature gives the
 * script, and the hooks it calls — physics' collision hooks — through `run`,
 * under the same guard.
 */
class ScriptBehaviour implements RuntimeBehaviour, ScriptSite {
  private failed = false;
  /** What each contribution installed, given back after `onDestroy`. */
  private installed: Disposable = { dispose() {} };
  /** Its script's ear on its entity's messages, for a script defining `onMessage`. */
  private hearing: Disposable | null = null;

  constructor(
    readonly script: Behaviour,
    readonly entity: Entity,
    readonly world: World,
    private readonly label: string,
  ) {}

  /** Each contribution's members given to the script, in the order they were registered. */
  install(contributions: readonly ScriptMembersDefinition[]): void {
    this.installed = combineDisposables(contributions.map((contribution) => contribution.install(this)));
  }

  /**
   * Hears its entity's messages, for a script defining `onMessage`, from its
   * making: so the scripts of one entity hear in the order they were made, and
   * one that hears nothing costs a delivery nothing.
   */
  listen(messages: EntityChannel<Message>): void {
    if (this.script.onMessage === undefined) return;
    this.hearing = messages.listen(this.entity.id, (message) => this.run('onMessage', this.script.onMessage, message));
  }

  run<A>(hook: string, call: ((this: Behaviour, arg: A) => void) | undefined, arg: A): void {
    if (this.failed || call === undefined) return;
    try {
      call.call(this.script, arg);
    } catch (cause) {
      this.fail(hook, cause);
    }
  }

  /** Self-contained setup, while other entities may still be under construction. */
  awake(): void {
    if (this.failed) return;
    try {
      this.script.onAwake?.();
    } catch (cause) {
      this.fail('onAwake', cause);
    }
  }

  /** Called by the world once every behaviour exists. */
  start(): void {
    if (this.failed) return;
    try {
      this.script.onStart?.();
    } catch (cause) {
      this.fail('onStart', cause);
    }
  }

  update(delta: number): void {
    this.script.time += delta;
    if (this.failed) return;
    try {
      this.script.onUpdate?.(delta);
    } catch (cause) {
      this.fail('onUpdate', cause);
    }
  }

  fixedUpdate(step: number): void {
    if (this.failed) return;
    try {
      this.script.onFixedUpdate?.(step);
    } catch (cause) {
      this.fail('onFixedUpdate', cause);
    }
  }

  postUpdate(): void {
    if (this.failed) return;
    try {
      this.script.onLateUpdate?.();
    } catch (cause) {
      this.fail('onLateUpdate', cause);
    }
  }

  /**
   * The scene is being left, and everything in it is still there to read.
   *
   * Published to scripts and reserved for two releases, and forwarded by no
   * one: the world told this adapter, which had no such hook, so a script's
   * `onSceneUnload` ran nowhere — not in the editor's Play, on a device or in
   * a build.
   */
  onSceneUnload(): void {
    if (this.failed) return;
    try {
      this.script.onSceneUnload?.();
    } catch (cause) {
      this.fail('onSceneUnload', cause);
    }
  }

  dispose(): void {
    // Cleanup runs even for a script that already failed. Skipping it was
    // exactly backwards: the script most likely to have left something behind
    // is the one that crashed.
    try {
      this.script.onDestroy?.();
    } catch (cause) {
      this.fail('onDestroy', cause);
    }
    this.script.cancelTimers();
    this.hearing?.dispose();
    // After `onDestroy`, which may still play a sound or read its body.
    this.installed.dispose();
  }

  private fail(phase: string, cause: unknown): void {
    this.failed = true;
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`[script] ${this.label}.${phase} threw, script disabled:`, cause);
    this.world.warn(`${this.label} failed in ${phase}: ${message}`);
  }
}

export const scriptBehaviour: BehaviourDefinition = {
  id: 'script',
  create(target: BehaviourTarget, world: World) {
    const { component } = target;
    if (component.type !== 'script' || component.assetId === null) return null;

    // The classes of the bundle this world was given, and of no other. Checked
    // as it is read: the world cannot name the script API without the API
    // naming the world back, so it holds them as values of no known type.
    const ScriptType = world.options.scripts?.get(component.assetId);
    if (!isScriptClass(ScriptType)) {
      world.warn(`"${target.entity.name}" references a script that is not compiled.`);
      return null;
    }
    // What the world's scripts share: the handles, the contributions and the
    // names they reserve. Left out of a test's own registries, nothing runs a
    // script.
    const scripts = worldScriptsOf(world);
    if (scripts === null) {
      world.warn(`"${target.entity.name}" has a script, and this world runs none: it has no scripts subsystem.`);
      return null;
    }

    const instance = new ScriptType();

    // Editable values are applied before onStart, so a script sees its
    // configured values the first time it runs — as in Unity and Unreal.
    // Anything named like a member is refused rather than allowed to overwrite
    // it, the kernel's or a contribution's: a property called `transform` would
    // replace the object the script is meant to move, and the failure would be
    // completely silent.
    const declared = ScriptType.properties ?? {};

    for (const [key, value] of Object.entries(component.props)) {
      // A value left over from a property the script no longer declares is
      // ignored rather than assigned: renaming a property would otherwise leave
      // a stale field on every instance forever.
      if (!Object.hasOwn(declared, key)) continue;
      if (scripts.reserved.has(key)) {
        world.warn(
          `"${target.entity.name}": script property "${key}" is a reserved name and was ignored.`,
        );
        continue;
      }
      Reflect.set(instance, key, value);
    }

    // Its entity's handle, the one `this.world.entity(its id)` answers: made
    // from what the world handed the behaviour, its record and its container.
    const entity = scripts.handle(target.entity, target.object);
    Object.assign(instance, {
      entity,
      transform: entity.transform,
      world: scripts,
      // `null` in a world handed no element to listen on, which only a test
      // builds: there is nothing a script there could hear.
      input: inputOf(world),
      scenes: world.options.scenes ?? null,
    });

    const behaviour = new ScriptBehaviour(instance, entity, world, `${target.entity.name}/${ScriptType.name}`);
    // What each feature gives it, before it first runs: a script reads its
    // body or plays its sound from `onAwake`.
    behaviour.install(scripts.contributions);
    behaviour.listen(scripts.messages);
    // Only `onAwake` here. `onStart` is run by the world once every behaviour
    // in the scene exists, so a script can reference another entity's script
    // without depending on which of them happened to be constructed first.
    behaviour.awake();
    return behaviour;
  },
};

export { Behaviour };
