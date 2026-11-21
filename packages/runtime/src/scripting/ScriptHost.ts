import type {
  Behaviour as RuntimeBehaviour,
  BehaviourDefinition,
  BehaviourTarget,
} from '../behaviour/Behaviour';
import { audioOf } from '../audio/audioOf';
import { inputOf } from '../input/inputOf';
import type { Collision } from '../physics/PhysicsApi';
import { physicsOf } from '../physics/physicsOf';
import type { World } from '../world/World';
import { audioApiFor } from './audioApi';
import { isScriptClass } from './scriptBundle';
import { noBody, scriptPhysicsFor } from './scriptPhysics';
import {
  Behaviour,
  RESERVED_PROPERTY_NAMES,
  internalContext,
} from './ScriptApi';

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
 */
class ScriptBehaviour implements RuntimeBehaviour {
  private failed = false;
  // Set for the hooks the script defines, and only those: a script that
  // defines none is not listening, so the world passes it by and never warns
  // that it can hear nothing.
  readonly onCollisionEnter?: (collision: Collision) => void;
  readonly onCollisionExit?: (other: string) => void;
  readonly onTriggerEnter?: (other: string) => void;
  readonly onTriggerExit?: (other: string) => void;

  constructor(
    private readonly instance: Behaviour,
    private readonly label: string,
    private readonly world: World,
  ) {
    if (instance.onCollisionEnter) {
      this.onCollisionEnter = (collision) => {
        if (this.failed) return;
        try {
          instance.onCollisionEnter?.(collision);
        } catch (cause) {
          this.fail('onCollisionEnter', cause);
        }
      };
    }
    if (instance.onCollisionExit) {
      this.onCollisionExit = (other) => {
        if (this.failed) return;
        try {
          instance.onCollisionExit?.(other);
        } catch (cause) {
          this.fail('onCollisionExit', cause);
        }
      };
    }
    if (instance.onTriggerEnter) {
      this.onTriggerEnter = (other) => {
        if (this.failed) return;
        try {
          instance.onTriggerEnter?.(other);
        } catch (cause) {
          this.fail('onTriggerEnter', cause);
        }
      };
    }
    if (instance.onTriggerExit) {
      this.onTriggerExit = (other) => {
        if (this.failed) return;
        try {
          instance.onTriggerExit?.(other);
        } catch (cause) {
          this.fail('onTriggerExit', cause);
        }
      };
    }
  }

  /** Self-contained setup, while other entities may still be under construction. */
  awake(): void {
    if (this.failed) return;
    try {
      this.instance.onAwake?.();
    } catch (cause) {
      this.fail('onAwake', cause);
    }
  }

  /** Called by the world once every behaviour exists. */
  start(): void {
    if (this.failed) return;
    try {
      this.instance.onStart?.();
    } catch (cause) {
      this.fail('onStart', cause);
    }
  }

  update(delta: number): void {
    this.instance.time += delta;
    if (this.failed) return;
    try {
      this.instance.onUpdate?.(delta);
    } catch (cause) {
      this.fail('onUpdate', cause);
    }
  }

  fixedUpdate(step: number): void {
    if (this.failed) return;
    try {
      this.instance.onFixedUpdate?.(step);
    } catch (cause) {
      this.fail('onFixedUpdate', cause);
    }
  }

  postUpdate(): void {
    if (this.failed) return;
    try {
      this.instance.onLateUpdate?.();
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
      this.instance.onSceneUnload?.();
    } catch (cause) {
      this.fail('onSceneUnload', cause);
    }
  }

  dispose(): void {
    // Cleanup runs even for a script that already failed. Skipping it was
    // exactly backwards: the script most likely to have left something behind
    // is the one that crashed.
    try {
      this.instance.onDestroy?.();
    } catch (cause) {
      this.fail('onDestroy', cause);
    }
    this.instance.cancelTimers();
    internalContext.delete(this.instance);
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

    const instance = new ScriptType();
    internalContext.set(instance, world);

    // Editable values are applied before onStart, so a script sees its
    // configured values the first time it runs — as in Unity and Unreal.
    // Anything named like a framework member is refused rather than allowed to
    // overwrite it: a property called `transform` would replace the object the
    // script is meant to move, and the failure would be completely silent.
    const declared = ScriptType.properties ?? {};

    for (const [key, value] of Object.entries(component.props)) {
      // A value left over from a property the script no longer declares is
      // ignored rather than assigned: renaming a property would otherwise leave
      // a stale field on every instance forever.
      if (!Object.hasOwn(declared, key)) continue;
      if (RESERVED_PROPERTY_NAMES.has(key)) {
        world.warn(
          `"${target.entity.name}": script property "${key}" is a reserved name and was ignored.`,
        );
        continue;
      }
      Reflect.set(instance, key, value);
    }

    const worldPhysics = physicsOf(world);
    const physics = scriptPhysicsFor(worldPhysics, world.document, target.entity, world.warn);
    Object.assign(instance, {
      entity: target.entity,
      transform: target.object,
      // With physics off — a host that has none, which is a test — the
      // stand-in is silent: the line would be about the host, not the scene.
      body:
        physics.body(target.entity.id) ??
        noBody(
          worldPhysics &&
            (() =>
              world.warn(
                `"${target.entity.name}" has no Rigid Body, on it or above it, so what its script does to this.body moves nothing. Add a Rigid Body to it or to an entity above it.`,
              )),
        ),
      physics,
      // `null` in a world handed no element to listen on, which only a test
      // builds: there is nothing a script there could hear.
      input: inputOf(world),
      scenes: world.options.scenes ?? null,
      // Bound to this entity, so `this.audio.play()` with no argument means "my
      // own sound" — the case a script wants ninety per cent of the time and the
      // one that should be shortest to write.
      audio: audioApiFor(audioOf(world), target.entity.id),
    });

    const behaviour = new ScriptBehaviour(instance, `${target.entity.name}/${ScriptType.name}`, world);
    // Only `onAwake` here. `onStart` is run by the world once every behaviour
    // in the scene exists, so a script can reference another entity's script
    // without depending on which of them happened to be constructed first.
    behaviour.awake();
    return behaviour;
  },
};

export { Behaviour };
