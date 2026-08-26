import type { EntityDoc, Vec3 } from '@three-studio/core';
import type { Object3D } from 'three/webgpu';
import type { BehaviourContext } from '../behaviour/Behaviour';
import type { Input } from '../input/Input';
import type { AudioApi } from './audioApi';
import type { SceneApi } from '../behaviour/Behaviour';

/** Declared shape of one editable property. Drives the inspector. */
export type ScriptPropertyDef =
  | { type: 'number'; default?: number; min?: number; max?: number; step?: number; label?: string }
  | { type: 'boolean'; default?: boolean; label?: string }
  | { type: 'string'; default?: string; label?: string }
  | { type: 'color'; default?: string; label?: string }
  | { type: 'vec3'; default?: Vec3; label?: string }
  | { type: 'enum'; options: readonly string[]; default?: string; label?: string }
  /** An entity picked in the scene; the script receives a live handle. */
  | { type: 'entity'; label?: string }
  /** An asset picked in the project; the script receives its id. */
  | { type: 'asset'; kind?: string; label?: string };

export type ScriptProperties = Record<string, ScriptPropertyDef>;

/**
 * Names a script property may not take.
 *
 * Applying properties onto the instance is what makes them editable, but it
 * also means a property called `transform` replaces the object the script is
 * supposed to move, and one called `log` replaces the method — silently, with
 * no error, leaving a script that cannot do anything and gives no clue why.
 */
export const RESERVED_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  'entity',
  'transform',
  'input',
  'scenes',
  'audio',
  'time',
  'log',
  'resolve',
  'wait',
  'repeat',
  'cancelTimers',
  'onAwake',
  'onStart',
  'onUpdate',
  'onFixedUpdate',
  'onLateUpdate',
  'onSceneUnload',
  'onDestroy',
]);

/** A live handle to another entity, resolved from an `entity` property. */
export interface EntityHandle {
  readonly id: string;
  readonly name: string;
  readonly object: Object3D;
}

/**
 * Base class for user scripts.
 *
 * The lifecycle mirrors Unity's and Unreal's because the split is not
 * cosmetic — each phase answers a different question, and putting work in the
 * wrong one produces bugs that look like physics problems:
 *
 *  - `onUpdate` runs once per displayed frame.
 *  - `onFixedUpdate` runs once per physics tick. Anything that commands a body
 *    belongs here; a kinematic body takes a target position rather than an
 *    impulse, so issuing two targets between one step discards the first.
 *  - `onLateUpdate` runs after physics, which is where anything following a
 *    subject has to be or it trails by a frame.
 */
export abstract class Behaviour {
  /**
   * Properties the editor should expose for this script.
   *
   * Declared rather than inferred: this is what a designer edits per instance,
   * so it has to be readable without running the script, and serialisable into
   * the scene. Same contract as Unity's `[SerializeField]`.
   */
  static properties: ScriptProperties = {};

  /** The entity this script is attached to. */
  readonly entity!: EntityDoc;
  /** Its transform, in three.js terms. Mutating it moves the object. */
  readonly transform!: Object3D;
  readonly input!: Input;
  /**
   * The mix: this entity's own sounds, one-shot clips, and the buses.
   *
   * Present even when the host handed over no audio context — every method is
   * then a no-op — so a script never has to ask whether sound exists before
   * asking for it.
   */
  readonly audio!: AudioApi;
  /**
   * Moving between scenes. `null` when nothing is hosting this engine — an
   * engine created directly has no notion of a next scene.
   */
  readonly scenes!: SceneApi | null;

  /** Seconds since play started. */
  time = 0;

  /**
   * Set this script up on its own, before any other script has started.
   *
   * Do not look for other entities here — they may not exist yet.
   */
  onAwake?(): void;
  /** Every script in the scene now exists. Cross-references belong here. */
  onStart?(): void;
  onUpdate?(delta: number): void;
  onFixedUpdate?(step: number): void;
  onLateUpdate?(): void;
  /**
   * The scene is being left, and everything is still here to read.
   *
   * Where state that has to survive the transition goes — a score, an
   * inventory. `onDestroy` runs after, once the teardown has begun, which is
   * too late to look anything up.
   */
  onSceneUnload?(): void;
  onDestroy?(): void;

  /** Timers owned by this script, cancelled when it is destroyed. */
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  /**
   * `setTimeout` scoped to this script's lifetime.
   *
   * A raw `setTimeout` keeps running after Stop — the script is gone, the scene
   * is restored, and the callback still fires against a dead world. These are
   * cancelled automatically, the way Unity ties a coroutine to its object.
   */
  protected wait(callback: () => void, ms: number): void {
    const id = setTimeout(() => {
      this.timers.delete(id);
      callback();
    }, ms);
    this.timers.add(id);
  }

  /** `setInterval` scoped to this script's lifetime. */
  protected repeat(callback: () => void, ms: number): () => void {
    const id = setInterval(callback, ms);
    this.timers.add(id);
    return () => {
      clearInterval(id);
      this.timers.delete(id);
    };
  }

  /** Called by the host after `onDestroy`; not part of the script surface. */
  cancelTimers(): void {
    for (const id of this.timers) {
      clearTimeout(id);
      clearInterval(id);
    }
    this.timers.clear();
  }

  /** Resolves an `entity` property to a live handle, or `null` if it is unset. */
  protected resolve(entityId: string | null | undefined): EntityHandle | null {
    if (!entityId) return null;
    const ctx = internalContext.get(this);
    const doc = ctx?.scene.entities[entityId];
    const object = ctx?.binder.getObject(entityId);
    if (!doc || !object) return null;
    return { id: entityId, name: doc.name, object };
  }

  /** Prints to the editor console, tagged with the entity it came from. */
  protected log(...args: unknown[]): void {
    console.log(`[${this.entity.name}]`, ...args);
  }
}

/**
 * Context injected by the host, kept off the public surface so a script cannot
 * reach the physics world or the binder by accident.
 */
export const internalContext = new WeakMap<Behaviour, BehaviourContext>();
