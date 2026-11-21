import type { ComponentDoc, ComponentId, ComponentTypeId, EntityId, SceneDoc } from '@three-studio/core';
import type { SceneBinder } from '../SceneBinder';

/**
 * How a subsystem is handed, one by one, the components of the types it
 * declares (`SubsystemDefinition.mounts`), as its world's document holds them:
 * what the scene was built with, then whatever a running game spawns, puts,
 * deletes and destroys. A subsystem builds nothing from the whole document; a
 * body, a behaviour, an ear is made when its component arrives and goes when
 * it leaves.
 *
 * Here rather than in `World.ts`, which imports this file: these are the hooks
 * the pass below calls, and `Subsystem` extends them.
 */
export interface MountHooks {
  /** A component of a type it mounts arrived: put on its entity, or its entity built or spawned. */
  mount?(entityId: EntityId, component: ComponentDoc): void;
  /**
   * It changed: `next` replaced `previous` under its id. `previous === next`:
   * it did not, but what it was built with outside itself did — an asset's
   * values, its entity's drawing — and is to be read again.
   */
  patch?(entityId: EntityId, previous: ComponentDoc, next: ComponentDoc): void;
  /** It left — deleted, or its entity destroyed — while the drawing side still holds the entity's objects. */
  unmount?(entityId: EntityId, component: ComponentDoc): void;
  /** A pass is over: everything mounted, patched or unmounted in it is in place. */
  settle?(): void;
}

/** One component handed out by a pass: mounted when there was none before it, patched otherwise. */
interface Arrival {
  readonly entityId: EntityId;
  readonly previous: ComponentDoc | null;
  readonly next: ComponentDoc;
}

interface Departure {
  readonly entityId: EntityId;
  readonly component: ComponentDoc;
}

/**
 * Pairs what each subsystem was handed against what the document holds now,
 * entity by entity, by component id — as the drawing side's `Reconciler` pairs
 * what it built, and beside it rather than inside it: the drawing side's
 * pairing carries objects, batches and late arrivals, and this one none of it.
 */
export class SubsystemMounts {
  /** By type, the subsystems handed its components, in the order they were registered. */
  private readonly routes = new Map<ComponentTypeId, MountHooks[]>();
  /** Every subsystem, in the order they were registered. */
  private readonly subsystems: MountHooks[] = [];
  /** What each entity's components were when last handed out, by component id: the subsystems' view of it. */
  private readonly handed = new Map<EntityId, Map<ComponentId, ComponentDoc>>();

  /** Hands `subsystem` the components of `types` from the next pass on, after those routed before it. */
  route(subsystem: MountHooks, types: readonly ComponentTypeId[]): void {
    this.subsystems.push(subsystem);
    for (const type of types) {
      const routed = this.routes.get(type);
      if (routed) routed.push(subsystem);
      else this.routes.set(type, [subsystem]);
    }
  }

  /** The types some subsystem mounts. */
  types(): MapIterator<ComponentTypeId> {
    return this.routes.keys();
  }

  /**
   * Brings every subsystem and the drawing side in line with `document` for
   * the entities in `dirty`, `reread`'s components handed back as they are.
   *
   * In an order each step relies on: every unmount, the last registered
   * subsystem first, so that a behaviour's `onDestroy` still finds its body,
   * and while the drawing side still holds the entity's objects; then the
   * drawing side; then every mount and patch, the first registered first, so
   * that a body is built from objects already placed and a behaviour after the
   * body it reads; then each subsystem's `settle`, in registration order.
   */
  pass(
    document: SceneDoc,
    dirty: ReadonlySet<EntityId>,
    reread: ReadonlySet<ComponentDoc>,
    binder: Pick<SceneBinder, 'sync'>,
  ): void {
    const departures: Departure[] = [];
    const arrivals: Arrival[] = [];
    for (const entityId of dirty) this.pair(document, entityId, reread, departures, arrivals);

    for (let i = this.subsystems.length - 1; i >= 0; i -= 1) {
      const subsystem = this.subsystems[i];
      if (subsystem?.unmount === undefined) continue;
      for (const { entityId, component } of departures) {
        if (this.routes.get(component.type)?.includes(subsystem)) subsystem.unmount(entityId, component);
      }
    }

    binder.sync(document, dirty);

    for (const subsystem of this.subsystems) {
      for (const { entityId, previous, next } of arrivals) {
        if (!this.routes.get(next.type)?.includes(subsystem)) continue;
        if (previous === null) subsystem.mount?.(entityId, next);
        else subsystem.patch?.(entityId, previous, next);
      }
    }

    for (const subsystem of this.subsystems) subsystem.settle?.();
  }

  /**
   * One entity's departures and arrivals, and what it was handed brought up to
   * date. Each type's table is read in place: nothing is made for a type the
   * entity holds nothing of.
   */
  private pair(
    document: SceneDoc,
    entityId: EntityId,
    reread: ReadonlySet<ComponentDoc>,
    departures: Departure[],
    arrivals: Arrival[],
  ): void {
    let handed = this.handed.get(entityId);

    // What it no longer holds: deleted, or gone with its entity, whose
    // components go with it. One whose type changed under its id — only a
    // hand-edited file does that — leaves, and arrives again below.
    for (const [id, previous] of handed ?? []) {
      if (document.components.get(previous.type)?.get(entityId)?.has(id)) continue;
      departures.push({ entityId, component: previous });
      handed?.delete(id);
    }

    for (const type of this.routes.keys()) {
      const held = document.components.get(type)?.get(entityId);
      if (held === undefined) continue;
      for (const [id, next] of held) {
        const previous = handed?.get(id);
        if (previous === undefined) {
          arrivals.push({ entityId, previous: null, next });
        } else if (previous !== next || reread.has(next)) {
          arrivals.push({ entityId, previous, next });
        } else {
          continue;
        }
        if (handed === undefined) {
          handed = new Map();
          this.handed.set(entityId, handed);
        }
        handed.set(id, next);
      }
    }

    if (handed?.size === 0) this.handed.delete(entityId);
  }
}
