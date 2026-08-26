import type { ScriptComponent } from '@three-studio/core';
import {
  registerBehaviour,
  type Behaviour as RuntimeBehaviour,
  type BehaviourContext,
  type BehaviourTarget,
} from '../behaviour/Behaviour';
import { audioApiFor } from './audioApi';
import {
  Behaviour,
  RESERVED_PROPERTY_NAMES,
  internalContext,
  type ScriptProperties,
} from './ScriptApi';

/** Constructor shape a compiled script module must default-export. */
export interface ScriptClass {
  new (): Behaviour;
  properties?: ScriptProperties;
}

const registry = new Map<string, ScriptClass>();

/**
 * Registers a compiled script under its asset id.
 *
 * The compiled bundle calls this once per script at import time, so the runtime
 * never has to know how scripts were built — the editor bundles them with
 * esbuild, and an exported web build ships the same bundle.
 */
export function registerScript(assetId: string, scriptClass: ScriptClass): void {
  registry.set(assetId, scriptClass);
}

export function scriptClassFor(assetId: string): ScriptClass | undefined {
  return registry.get(assetId);
}

export function clearScripts(): void {
  registry.clear();
}

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

  constructor(
    private readonly instance: Behaviour,
    private readonly label: string,
    private readonly ctx: BehaviourContext,
  ) {}

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

registerBehaviour('script', (target: BehaviourTarget, ctx: BehaviourContext) => {
  const component = target.component as ScriptComponent;
  if (component.assetId === '') return null;

  const ScriptType = registry.get(component.assetId);
  if (!ScriptType) {
    ctx.warn(`"${target.entity.name}" references a script that is not compiled.`);
    return null;
  }

  const instance = new ScriptType();
  internalContext.set(instance, ctx);

  // Editable values are applied before onStart, so a script sees its configured
  // values the first time it runs — as in Unity and Unreal. Anything named like
  // a framework member is refused rather than allowed to overwrite it: a
  // property called `transform` would replace the object the script is meant to
  // move, and the failure would be completely silent.
  const declared = ScriptType.properties ?? {};

  for (const [key, value] of Object.entries(component.props)) {
    // A value left over from a property the script no longer declares is
    // ignored rather than assigned: renaming a property would otherwise leave a
    // stale field on every instance forever.
    if (!Object.hasOwn(declared, key)) continue;
    if (RESERVED_PROPERTY_NAMES.has(key)) {
      ctx.warn(
        `"${target.entity.name}": script property "${key}" is a reserved name and was ignored.`,
      );
      continue;
    }
    (instance as unknown as Record<string, unknown>)[key] = value;
  }

  Object.assign(instance, {
    entity: target.entity,
    transform: target.object,
    input: ctx.input,
    scenes: ctx.scenes,
    // Bound to this entity, so `this.audio.play()` with no argument means "my
    // own sound" — the case a script wants ninety per cent of the time and the
    // one that should be shortest to write.
    audio: audioApiFor(ctx.audio, target.entity.id),
  });

  const behaviour = new ScriptBehaviour(instance, `${target.entity.name}/${ScriptType.name}`, ctx);
  // Only `onAwake` here. `onStart` is run by the engine once every behaviour in
  // the scene exists, so a script can reference another entity's script without
  // depending on which of them happened to be constructed first.
  behaviour.awake();
  return behaviour;
});

export { Behaviour };
