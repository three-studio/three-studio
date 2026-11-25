import type { FieldDef } from '@three-studio/core';
import type { Input } from '../input/Input';
import type { SceneApi } from '../sceneApi';
import type { Entity, EntityTransform, Message, ScriptWorld } from './Entity';

/**
 * Declared shape of one editable property. Drives the inspector.
 *
 * The name is the contract, not the shape: user scripts and the generated
 * `.d.ts` say `ScriptPropertyDef`, so it stays — but the variants moved
 * to `core` as `FieldDef`, where an importer declares its rows in the same
 * words and one adapter in the editor binds both. See `core/src/fields.ts`.
 */
export type ScriptPropertyDef = FieldDef;

export type ScriptProperties = Record<string, ScriptPropertyDef>;

/**
 * What the features give every script besides what the host gives it:
 * physics' `body`, `physics` and collision hooks, audio's `audio`.
 *
 * Empty here, and augmented by each feature in a file of its own
 * (`declare module '…/scripting/ScriptApi'`), so `this.body` is typed
 * wherever physics is compiled while this folder names no feature. What a
 * feature gives is its contribution (`ScriptMembersDefinition`), which installs
 * the members, reserves their names and publishes their typings.
 */
export interface ScriptMembers {}

/** What the host gives every script before its first hook. */
interface HostGiven {
  /** The entity this script is attached to: its handle, the one `world.entity(its id)` gives. */
  readonly entity: Entity;
  /**
   * Its transform, the entity's: the drawing's own vectors, written in place to
   * move it, and the entity's body with it:
   *  - a dynamic body, or the player, is put there and keeps its speed;
   *  - a kinematic body moves there at the next tick, carrying what rests on it;
   *  - a fixed body's collider stays where it is, and so does a collider riding
   *    an ancestor's body: it sits where the world was built, and only the mesh
   *    moves.
   */
  readonly transform: EntityTransform;
  /** The world it runs in: other entities by id. */
  readonly world: ScriptWorld;
  readonly input: Input;
  /**
   * Moving between scenes. `null` when nothing is hosting this world — a
   * world made directly has no notion of a next scene.
   */
  readonly scenes: SceneApi | null;
}

/**
 * Merged with the class: what the host and the contributions give a script,
 * typed on every `Behaviour` with no field of the class, where each was an
 * assignment the host kept, asserted and never checked, and one more per
 * feature. None is there yet when a field initialiser runs: they are given
 * once the script is made.
 */
export interface Behaviour extends HostGiven, ScriptMembers {}

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
 *
 * What a feature adds — the body and the collision hooks, the mix — is merged
 * in through `ScriptMembers`.
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
   * A message sent to this entity (`entity.send`), heard at the start of the
   * frame after it was sent, before any `onUpdate`.
   */
  onMessage?(message: Message): void;
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

  /** Prints to the editor console, tagged with the entity it came from. */
  protected log(...args: unknown[]): void {
    console.log(`[${this.entity.name}]`, ...args);
  }
}
