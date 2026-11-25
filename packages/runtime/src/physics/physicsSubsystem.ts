import {
  createPhysicsSettings,
  fixedId,
  type AssetId,
  type ComponentDoc,
  type Disposable,
  type EntityId,
  type PhysicsMaterialDef,
  type PhysicsSettings,
} from '@three-studio/core';
import { EntityChannel } from '../world/channel';
import type { Subsystem, SubsystemDefinition, World } from '../world/World';
import { physicsSetupProblems } from './diagnostics';
import type { Touch, Vec3Like } from './PhysicsApi';
import { providePhysics } from './physicsOf';
import { PhysicsWorld, type ColliderOwner, type PhysicsEvent } from './PhysicsWorld';

/**
 * Rapier's world, stepped by the world's clock: handed each Rigid Body,
 * Collider and Joint as the world's document holds them, ticked once per fixed
 * step, drawn onto the entities once per frame, and heard through its
 * collision channel.
 */
export const physicsSubsystem: SubsystemDefinition = {
  id: fixedId('subsystem', 'physics'),
  // A tick after the behaviours' fixed hooks, which command the bodies for it;
  // the bodies drawn before their late hooks, which place a camera on a body
  // where it ended the frame.
  order: { fixed: 100, lateUpdate: -100 },
  mounts: ['rigidbody', 'collider', 'joint'],
  async create(world) {
    const settings = world.options.physicsSettings ?? createPhysicsSettings();
    const materials = world.options.physicsMaterials ?? new Map<AssetId, PhysicsMaterialDef>();
    // Rapier alone: nothing is built at creation. A collider derived from a
    // model is built again when the model lands, and a scene starts only once
    // every model it draws has (`LoadedScene.ready`): built from the empty group
    // a glTF hangs from before it arrives, an imported level was a box the
    // player fell straight past.
    const physics = await PhysicsWorld.create(settings, {
      scene: world.document,
      objects: world.binder,
      materials,
      assetValues: (assetId) => world.assetValues(assetId),
    });
    return new PhysicsSubsystem(world, physics, settings, materials);
  },
};

class PhysicsSubsystem implements Subsystem {
  private readonly collisions = new EntityChannel<Touch>();
  private readonly provided: Disposable;

  constructor(
    private readonly world: World,
    private readonly physics: PhysicsWorld,
    private readonly settings: PhysicsSettings,
    private readonly materials: ReadonlyMap<AssetId, PhysicsMaterialDef>,
  ) {
    this.provided = providePhysics(world, physics, this.collisions);
  }

  /**
   * One tick, then what it heard: after the tick it happened in, and before
   * the next one's fixed hooks, as Unity runs its collision messages.
   */
  fixed(): void {
    const events = this.physics.tick();
    for (let i = 0; i < events.length; i += 1) {
      const event = events[i];
      if (event === undefined) continue;
      this.tell(event, event.a, event.b.entity, 1);
      this.tell(event, event.b, event.a.entity, -1);
    }
  }

  lateUpdate(): void {
    this.physics.writeBack(this.world.fixedAlpha);
  }

  mount(entityId: EntityId, component: ComponentDoc): void {
    this.physics.mount(entityId, component);
  }

  patch(entityId: EntityId, previous: ComponentDoc, next: ComponentDoc): void {
    this.physics.patch(entityId, previous, next);
  }

  unmount(entityId: EntityId, component: ComponentDoc): void {
    this.physics.unmount(entityId, component);
  }

  settle(): void {
    this.physics.settle();
  }

  start(): void {
    this.physics.start();
  }

  diagnose(): readonly string[] {
    return physicsSetupProblems({
      scene: this.world.document,
      settings: this.settings,
      materials: this.materials,
      binder: this.world.binder,
      // Asked once the world is built, so every listener has begun.
      listening: this.collisions.listenedEntities(),
    });
  }

  dispose(): void {
    this.provided.dispose();
    this.physics.dispose();
  }

  /**
   * One side of an event, told to its collider's entity, then to its body's
   * when that is another: a cart hears its wheels, and a wheel listened on
   * for itself hears itself. `other` is the other side's collider's entity,
   * and `sign` turns the contact's normal, which pushes `a`, into the one that
   * pushes this side.
   *
   * Unguarded: whoever listens guards what it runs, as a script's behaviour
   * guards its hooks.
   */
  private tell(event: PhysicsEvent, side: ColliderOwner, other: EntityId, sign: 1 | -1): void {
    const touch: Touch =
      event.kind === 'collisionEnter'
        ? {
            kind: 'collisionEnter',
            collision: {
              other,
              point: event.contact.point,
              normal: scaled(event.contact.normal, sign),
              impulse: event.contact.impulse,
            },
          }
        : { kind: event.kind, other };
    this.collisions.publish(side.entity, touch);
    if (side.body !== side.entity) this.collisions.publish(side.body, touch);
  }
}

function scaled(vector: Readonly<Vec3Like>, by: number): Vec3Like {
  return { x: by * vector.x, y: by * vector.y, z: by * vector.z };
}
