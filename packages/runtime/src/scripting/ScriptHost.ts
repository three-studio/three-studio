import type {
  Behaviour as RuntimeBehaviour,
  BehaviourContext,
  BehaviourDefinition,
  BehaviourTarget,
} from '../behaviour/Behaviour';
import type { Collision } from '../physics/PhysicsApi';
import { audioApiFor } from './audioApi';
import { isScriptClass } from './scriptBundle';
import { noBody, scriptPhysicsFor } from './scriptPhysics';
import {
  Behaviour,
  RESERVED_PROPERTY_NAMES,
  internalContext,
} from './ScriptApi';

/**
 * Adapts a user script to the engine's behaviour interface.
 *
 * Errors are caught per phase and reported once rather than per frame: a script
 * that throws every tick would otherwise bury the console and take the whole
 * game down with it. A failed script is disabled and named, which is what makes
 * the problem findable.
 */
class ScriptBehaviour implements RuntimeBehaviour {
  private failed = false;
  // Set for the hooks the script defines, and only those: a script that
  // defines none is not listening, so the engine passes it by and never warns
  // that it can hear nothing.
  readonly onCollisionEnter?: (collision: Collision) => void;
  readonly onCollisionExit?: (other: string) => void;
  readonly onTriggerEnter?: (other: string) => void;
  readonly onTriggerExit?: (other: string) => void;

  constructor(
    private readonly instance: Behaviour,
    private readonly label: string,
    private readonly ctx: BehaviourContext,
  ) {
    if (instance.onCollisionEnter) {
      this.onCollisionEnter = (collision) =>
        this.guard('onCollisionEnter', () => instance.onCollisionEnter?.(collision));
    }
    if (instance.onCollisionExit) {
      this.onCollisionExit = (other) => this.guard('onCollisionExit', () => instance.onCollisionExit?.(other));
    }
    if (instance.onTriggerEnter) {
      this.onTriggerEnter = (other) => this.guard('onTriggerEnter', () => instance.onTriggerEnter?.(other));
    }
    if (instance.onTriggerExit) {
      this.onTriggerExit = (other) => this.guard('onTriggerExit', () => instance.onTriggerExit?.(other));
    }
  }

  /** Self-contained setup, while other entities may still be under construction. */
  awake(): void {
    this.guard('onAwake', () => this.instance.onAwake?.());
  }

  /** Called by the engine once every behaviour exists. */
  start(): void {
    this.guard('onStart', () => this.instance.onStart?.());
  }

  update(delta: number): void {
    this.instance.time += delta;
    this.guard('onUpdate', () => this.instance.onUpdate?.(delta));
  }

  fixedUpdate(step: number): void {
    this.guard('onFixedUpdate', () => this.instance.onFixedUpdate?.(step));
  }

  postUpdate(): void {
    this.guard('onLateUpdate', () => this.instance.onLateUpdate?.());
  }

  dispose(): void {
    // Cleanup runs even for a script that already failed. Skipping it was
    // exactly backwards: the script most likely to have left something behind
    // is the one that crashed.
    this.failed = false;
    this.guard('onDestroy', () => this.instance.onDestroy?.());
    this.instance.cancelTimers();
    internalContext.delete(this.instance);
  }

  private guard(phase: string, run: () => void): void {
    if (this.failed) return;
    try {
      run();
    } catch (cause) {
      this.failed = true;
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error(`[script] ${this.label}.${phase} threw, script disabled:`, cause);
      this.ctx.warn(`${this.label} failed in ${phase}: ${message}`);
    }
  }
}

export const scriptBehaviour: BehaviourDefinition = {
  id: 'script',
  create(target: BehaviourTarget, ctx: BehaviourContext) {
    const { component } = target;
    if (component.type !== 'script' || component.assetId === null) return null;

    // The classes of the bundle this engine was given, and of no other. Checked
    // as it is read: the context cannot name the script API without the API
    // naming the context back, so it holds them as values of no known type.
    const ScriptType = ctx.scripts.get(component.assetId);
    if (!isScriptClass(ScriptType)) {
      ctx.warn(`"${target.entity.name}" references a script that is not compiled.`);
      return null;
    }

    const instance = new ScriptType();
    internalContext.set(instance, ctx);

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
        ctx.warn(
          `"${target.entity.name}": script property "${key}" is a reserved name and was ignored.`,
        );
        continue;
      }
      Reflect.set(instance, key, value);
    }

    const physics = scriptPhysicsFor(ctx.physics, ctx.scene, target.entity, ctx.warn);
    Object.assign(instance, {
      entity: target.entity,
      transform: target.object,
      // With physics off — a host that has none, which is a test — the
      // stand-in is silent: the line would be about the host, not the scene.
      body:
        physics.body(target.entity.id) ??
        noBody(
          ctx.physics &&
            (() =>
              ctx.warn(
                `"${target.entity.name}" has no Rigid Body, on it or above it, so what its script does to this.body moves nothing. Add a Rigid Body to it or to an entity above it.`,
              )),
        ),
      physics,
      input: ctx.input,
      scenes: ctx.scenes,
      // Bound to this entity, so `this.audio.play()` with no argument means "my
      // own sound" — the case a script wants ninety per cent of the time and the
      // one that should be shortest to write.
      audio: audioApiFor(ctx.audio, target.entity.id),
    });

    const behaviour = new ScriptBehaviour(instance, `${target.entity.name}/${ScriptType.name}`, ctx);
    // Only `onAwake` here. `onStart` is run by the engine once every behaviour
    // in the scene exists, so a script can reference another entity's script
    // without depending on which of them happened to be constructed first.
    behaviour.awake();
    return behaviour;
  },
};

export { Behaviour };
