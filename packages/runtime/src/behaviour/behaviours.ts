import { componentsOfType, fixedId, type ComponentTypeId, type Disposable, type Registry } from '@three-studio/core';
import { collisionsOf } from '../physics/physicsOf';
import type { Touch } from '../physics/PhysicsApi';
import { CAMERA_PRIORITY } from '../world/cameras';
import type { Subsystem, SubsystemDefinition, World } from '../world/World';
import type { Behaviour, BehaviourDefinition } from './Behaviour';

/**
 * The behaviours of a world in Play, one per component whose type has one
 * registered: the player controllers, the audio sources, the scripts.
 *
 * Handed the behaviours' registry when the runtime is activated, the one
 * subsystem that reads a registry, so that the world never names it.
 * Registered after input, physics and audio, which every behaviour may reach
 * from the moment it is built; and at 0 in each phase it claims, so a body
 * ticks after the fixed hooks that command it, and is drawn before the late
 * hooks that place a camera on it.
 */
export function behaviourSubsystem(registry: Registry<ComponentTypeId, BehaviourDefinition>): SubsystemDefinition {
  return {
    id: fixedId('subsystem', 'behaviours'),
    async create(world) {
      // The models in first, physics or none: a script reads its model's nodes
      // from `onAwake`. Physics awaited them already, when it is there.
      await world.binder.whenLoaded();
      return new Behaviours(world, registry);
    },
  };
}

class Behaviours implements Subsystem {
  /** In the order they were built: by type as registered, then by entity as the scene holds them. */
  private readonly all: Behaviour[] = [];
  /**
   * What they hold of the world, given back with them: the listeners of those
   * that hear what colliders touch, on physics' channel, and the claims of
   * those that drive a camera.
   */
  private readonly held: Disposable[] = [];
  /** How many want to drive the camera: two is a line. */
  private readonly drivers: number;

  constructor(world: World, registry: Registry<ComponentTypeId, BehaviourDefinition>) {
    const collisions = collisionsOf(world);
    let drivers = 0;

    // Driven by the registry and then by the tables of the types it names: a
    // scene of two thousand props with one player controller in it visits one
    // entity. It used to walk them all, and every component of each. Nothing
    // here names a type: a new kind of controller is a registration.
    for (const definition of registry.values()) {
      for (const [entityId, held] of componentsOfType(world.document, definition.id)) {
        const entity = world.document.entities.get(entityId);
        const object = world.binder.getObject(entityId);
        if (!entity || !object) continue;

        for (const component of held.values()) {
          const behaviour = definition.create({ entity, object, component }, world);
          if (!behaviour) continue;
          this.all.push(behaviour);

          // Over the scene's own cameras: what drives the view is the view you
          // are in. The first of two drivers wins, and is said.
          if (behaviour.camera) {
            drivers += 1;
            this.held.push(world.cameras.claim(behaviour.camera, CAMERA_PRIORITY.driven));
          }
          // What its entity's colliders touch, and those of the children
          // riding its body when it is a body's: physics publishes to both.
          if (collisions && listens(behaviour)) {
            this.held.push(collisions.listen(entityId, (touch) => hear(behaviour, touch)));
          }
        }
      }
    }
    this.drivers = drivers;

    // Second pass. Everything now exists, so a behaviour can look another one
    // up regardless of which entity was built first.
    for (const behaviour of this.all) behaviour.start?.();
  }

  // Aiming runs at display rate; movement runs inside the fixed step, because
  // a kinematic body is commanded with a target position rather than an
  // impulse — issuing two targets between one step discards the first.
  update(delta: number): void {
    for (let i = 0; i < this.all.length; i += 1) this.all[i]?.update?.(delta);
  }

  fixed(step: number): void {
    for (let i = 0; i < this.all.length; i += 1) this.all[i]?.fixedUpdate?.(step);
  }

  lateUpdate(): void {
    for (let i = 0; i < this.all.length; i += 1) this.all[i]?.postUpdate?.();
  }

  diagnose(): readonly string[] {
    return this.drivers > 1 ? [`${this.drivers} components want to drive the camera; the first one wins.`] : [];
  }

  /**
   * Tells every behaviour the scene is going away, before anything is taken
   * apart.
   *
   * Separate from `dispose` because the two answer different questions: this
   * one is "we are leaving, save what matters" and still has a live scene to
   * read; `dispose` is the teardown itself. Unity splits them the same way
   * with `OnDisable` and `OnDestroy`.
   */
  sceneUnload(): void {
    for (const behaviour of this.all) {
      try {
        behaviour.onSceneUnload?.();
      } catch (cause) {
        // One script refusing to leave must not strand the transition.
        console.error('[scene] onSceneUnload threw', cause);
      }
    }
  }

  dispose(): void {
    for (const behaviour of this.all) behaviour.dispose?.();
    this.all.length = 0;
    for (const holding of this.held) holding.dispose();
    this.held.length = 0;
  }
}

/** Whether a behaviour hears what its entity's colliders touch. */
function listens(behaviour: Behaviour): boolean {
  return (
    behaviour.onCollisionEnter !== undefined ||
    behaviour.onCollisionExit !== undefined ||
    behaviour.onTriggerEnter !== undefined ||
    behaviour.onTriggerExit !== undefined
  );
}

/**
 * What one side of a pair heard, told to a behaviour on it.
 *
 * Unguarded, as `update` is: a script's hook is guarded by its own behaviour.
 */
function hear(behaviour: Behaviour, touch: Touch): void {
  switch (touch.kind) {
    case 'collisionEnter': {
      // A copy each, so no listener can change what the next one hears.
      const { other, point, normal, impulse } = touch.collision;
      behaviour.onCollisionEnter?.({
        other,
        point: { x: point.x, y: point.y, z: point.z },
        normal: { x: normal.x, y: normal.y, z: normal.z },
        impulse,
      });
      break;
    }
    case 'collisionExit':
      behaviour.onCollisionExit?.(touch.other);
      break;
    case 'triggerEnter':
      behaviour.onTriggerEnter?.(touch.other);
      break;
    case 'triggerExit':
      behaviour.onTriggerExit?.(touch.other);
      break;
  }
}
