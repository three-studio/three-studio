import type { Disposable, EntityId } from '@three-studio/core';

/**
 * Events addressed to entities: whoever listens on an entity hears what is
 * published to it, in the order they began listening.
 *
 * A kernel class, so that a feature's events need no field of the world:
 * physics publishes its collisions on one, reached by its own accessor.
 */
export class EntityChannel<Event> {
  /**
   * Replaced rather than changed when a listener comes or goes, so a listener
   * that stops listening while it hears an event leaves the publish in hand
   * walking the array it started with.
   */
  private readonly listeners = new Map<EntityId, readonly ((event: Event) => void)[]>();

  /** Hears what is published to `entityId` until the result is disposed. */
  listen(entityId: EntityId, listener: (event: Event) => void): Disposable {
    this.listeners.set(entityId, [...(this.listeners.get(entityId) ?? []), listener]);
    let listening = true;
    return {
      dispose: () => {
        if (!listening) return;
        listening = false;
        const left = (this.listeners.get(entityId) ?? []).filter((each) => each !== listener);
        if (left.length > 0) this.listeners.set(entityId, left);
        else this.listeners.delete(entityId);
      },
    };
  }

  /** Tells `entityId`'s listeners, in the order they began listening. Nothing is made. */
  publish(entityId: EntityId, event: Event): void {
    const listening = this.listeners.get(entityId);
    if (listening === undefined) return;
    for (let i = 0; i < listening.length; i += 1) listening[i]?.(event);
  }

  /** The entities somebody listens on, in the order each was first listened on. */
  listenedEntities(): readonly EntityId[] {
    return [...this.listeners.keys()];
  }
}
