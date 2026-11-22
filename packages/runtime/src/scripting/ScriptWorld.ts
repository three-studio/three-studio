import {
  createEntity,
  createTransform,
  fixedId,
  isAssetId,
  isEntityId,
  isRecord,
  type EntityDoc,
  type EntityId,
  type Registry,
  type ScriptMembersId,
  type Transform,
  type Vec3,
} from '@three-studio/core';
import type { Object3D } from 'three/webgpu';
import { EntityChannel } from '../world/channel';
import type { SubsystemDefinition, World } from '../world/World';
import {
  Entity,
  type Envelope,
  type HandleHost,
  type Message,
  type PlaceOptions,
  type SpawnOptions,
} from './Entity';
import type { ScriptMembersDefinition } from './members';
import { reservedScriptNames } from './typings';

/**
 * What a world's scripts share: the handles of its entities, the contributions
 * installed into each script, and the names those reserve with the kernel's.
 * Made once per world by its scripts subsystem, reached by `worldScriptsOf`,
 * and given to each of its scripts as `this.world`.
 */
export class WorldScripts implements HandleHost {
  /** Every name a script property may not take, each contribution's included. */
  readonly reserved: ReadonlySet<string>;
  /**
   * Where each entity's messages are heard: each script defining `onMessage`
   * listens on its entity from its making until it is destroyed.
   */
  readonly messages = new EntityChannel<Message>();
  /**
   * Each entity's handle, by its container: a handle lives as long as the
   * drawing does, so a churn of spawns leaves nothing behind here, and nothing
   * has to be told when an entity goes.
   */
  private readonly handles = new WeakMap<Object3D, Entity>();
  /**
   * What was sent since the last delivery, and the array the one before was
   * delivered from: swapped at each, so a frame's messages cost the queue no
   * array, and what a handler sends waits for the next frame.
   */
  private queued: Envelope[] = [];
  private delivering: Envelope[] = [];

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

  post(envelope: Envelope): void {
    this.queued.push(envelope);
  }

  /**
   * Hands each message sent since the last delivery to its entity's listeners,
   * in send order; one whose entity is gone is dropped. At the start of the
   * frame, before any `onUpdate`: a spawn made last frame has started, so it
   * hears what was sent to it in its spawn frame — which Unity's immediate
   * `SendMessage` would have lost.
   */
  deliver(): void {
    if (this.queued.length === 0) return;
    const batch = this.queued;
    this.queued = this.delivering;
    this.delivering = batch;
    for (const envelope of batch) {
      if (this.world.document.entities.has(envelope.to)) this.messages.publish(envelope.to, envelope);
    }
    batch.length = 0;
  }

  /**
   * A new entity, posed as `options` say, drawn from the call: its handle's
   * transform is there to move at once. Its components, body and scripts come
   * at the frame's pass. `null`, with the script told, for options that do not
   * read.
   */
  spawn(options: SpawnOptions = {}): Entity | null {
    const placement = this.placement('spawn', options);
    if (placement === null) return null;
    const name = isRecord(options) && typeof options['name'] === 'string' ? options['name'] : 'Entity';
    const template = createEntity(name);
    template.entity.transform = placement.transform;
    const spawned = this.world.spawn(template, placement.parent);
    return spawned === null ? null : this.entity(spawned);
  }

  /**
   * A placement of `prefab`, its contents under it, drawn from the call as a
   * spawn is. `null`, with the script told, for text that names no prefab this
   * world was handed, or options that do not read.
   */
  instantiate(prefab: string, options: PlaceOptions = {}): Entity | null {
    const placement = this.placement('instantiate', options);
    if (placement === null) return null;
    const placed = isAssetId(prefab) ? this.world.instantiate(prefab, placement) : null;
    if (placed === null) {
      this.world.warn(`instantiate: "${String(prefab)}" is no prefab this game was given.`);
      return null;
    }
    return this.entity(placed);
  }

  /**
   * Where a spawn or a placement goes, read from a script's options, which are
   * not typechecked where they come from: the parent a live handle of this
   * world, each vector three finite numbers. `null`, with the script told, at
   * the first that does not read: a NaN in a document is a body Rapier cannot
   * place, and a parent of another world an entity drawn under nothing.
   */
  private placement(call: string, options: unknown): { parent: EntityId | null; transform: Transform } | null {
    if (!isRecord(options)) {
      this.world.warn(`${call}: its options are no object.`);
      return null;
    }
    const given = options['parent'] ?? null;
    const parent = given instanceof Entity && this.handles.get(given.object3D) === given ? given : null;
    if (given !== null && parent === null) {
      this.world.warn(`${call}: its parent is no entity of this game.`);
      return null;
    }
    if (parent !== null && !parent.alive) {
      this.world.warn(`${call}: its parent "${parent.name}" is destroyed.`);
      return null;
    }
    const transform = createTransform();
    for (const key of ['position', 'rotation', 'scale'] as const) {
      const given = options[key];
      if (given === undefined) continue;
      const vector = vectorOf(given);
      if (vector === null) {
        this.world.warn(`${call}: its ${key} is no vector of three finite numbers.`);
        return null;
      }
      transform[key] = vector;
    }
    return { parent: parent === null ? null : parent.id, transform };
  }
}

/** `{ x, y, z }` read as the document's tuple; `null` unless each is a finite number. */
function vectorOf(value: unknown): Vec3 | null {
  if (!isRecord(value)) return null;
  const { x, y, z } = value;
  return isFiniteNumber(x) && isFiniteNumber(y) && isFiniteNumber(z) ? [x, y, z] : null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
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
    // Messages are delivered before the behaviours' updates, at 0.
    order: { update: -1 },
    create(world) {
      const scripts = new WorldScripts(world, registry.values());
      worlds.set(world, scripts);
      return {
        update: () => scripts.deliver(),
        dispose() {
          worlds.delete(world);
        },
      };
    },
  };
}
