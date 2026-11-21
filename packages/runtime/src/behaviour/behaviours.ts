import {
  componentsOfType,
  fixedId,
  type ComponentDoc,
  type ComponentId,
  type ComponentTypeId,
  type Disposable,
  type EntityId,
  type Registry,
} from '@three-studio/core';
import { collisionsOf } from '../physics/physicsOf';
import type { Touch } from '../physics/PhysicsApi';
import { CAMERA_PRIORITY } from '../world/cameras';
import type { EntityChannel } from '../world/channel';
import type { Subsystem, SubsystemDefinition, World } from '../world/World';
import type { Behaviour, BehaviourDefinition } from './Behaviour';

/**
 * The behaviours of a world in Play, one per component whose type has one
 * registered: the player controllers, the audio sources, the scripts.
 *
 * Handed the behaviours' registry when the runtime is activated, so that the
 * world never names it. Registered after input, physics, audio and the
 * scripts, which every behaviour may reach from the moment it is built; and at
 * 0 in each phase it claims, so a body ticks after the fixed hooks that command
 * it, and is drawn before the late hooks that place a camera on it.
 */
export function behaviourSubsystem(registry: Registry<ComponentTypeId, BehaviourDefinition>): SubsystemDefinition {
  return {
    id: fixedId('subsystem', 'behaviours'),
    // Read when a world is made, after every activation: a module's
    // behaviours register after the kernel's, which made this definition.
    get mounts() {
      return registry.values().map((definition) => definition.id);
    },
    create(world) {
      // Made at `start`, once the world is ready: every model has landed, so a
      // script reads its model's nodes from `onAwake`.
      return new Behaviours(world, registry);
    },
  };
}

/** A behaviour made for one component, and what it holds of the world, given back with it. */
interface Made {
  readonly behaviour: Behaviour;
  /** Its type's place in the registry, which is its run's in `all`. */
  readonly type: number;
  /** Its camera claim, its listener on physics' channel. */
  readonly held: readonly Disposable[];
}

class Behaviours implements Subsystem {
  /**
   * Every behaviour, in the order a phase runs them: a run per registered
   * type, in registry order, each in the order its behaviours were made. So
   * the player controller places its camera before any script's
   * `onLateUpdate` reads it, and a spawned behaviour runs after those of its
   * type already there, before the next type's. One array, which a frame walks
   * with one indexed loop per phase.
   */
  private readonly all: Behaviour[] = [];
  /** How many of `all` each type holds, by its place in the registry. */
  private readonly counts: number[] = [];
  private readonly typeOf = new Map<ComponentTypeId, number>();
  /** What each mounted component made, by entity and component id: taken down at its unmount. */
  private readonly made = new Map<EntityId, Map<ComponentId, Made>>();
  /** Mounted before the world started, by entity: made at `start`, in the order the scene was always built in. */
  private readonly waiting = new Map<EntityId, Set<ComponentId>>();
  /** Mounted by a pass once started: made when it settles, in mount order. */
  private arrived: { readonly entityId: EntityId; readonly component: ComponentDoc }[] = [];
  private started = false;
  /** How many have wanted to drive the camera: two is a line. */
  private drivers = 0;
  private readonly collisions: EntityChannel<Touch> | null;

  constructor(
    private readonly world: World,
    private readonly registry: Registry<ComponentTypeId, BehaviourDefinition>,
  ) {
    this.collisions = collisionsOf(world);
    for (const definition of registry.values()) {
      this.typeOf.set(definition.id, this.counts.length);
      this.counts.push(0);
    }
  }

  mount(entityId: EntityId, component: ComponentDoc): void {
    if (this.started) {
      this.arrived.push({ entityId, component });
      return;
    }
    const waiting = this.waiting.get(entityId);
    if (waiting) waiting.add(component.id);
    else this.waiting.set(entityId, new Set([component.id]));
  }

  /**
   * The behaviours of a scene, once all of it is built: each type in registry
   * order, each entity in its type's table order, every one awake as it is
   * made, then every one started — a behaviour can find any other from
   * `onStart`, whichever was made first.
   *
   * Driven by the registry and then by the tables of the types it names: a
   * scene of two thousand props with one player controller in it visits one
   * entity, and nothing here names a type.
   */
  start(): void {
    this.started = true;
    const made: Behaviour[] = [];
    for (const definition of this.registry.values()) {
      for (const [entityId, held] of componentsOfType(this.world.document, definition.id)) {
        const waiting = this.waiting.get(entityId);
        if (waiting === undefined) continue;
        for (const component of held.values()) {
          if (!waiting.has(component.id)) continue;
          const behaviour = this.make(entityId, component);
          if (behaviour) made.push(behaviour);
        }
      }
    }
    this.waiting.clear();
    for (const behaviour of made) behaviour.start?.();
  }

  /**
   * What a pass mounted, once physics has settled it, so that a controller
   * finds its body: made in mount order, then started, before any of them
   * updates — a spawned script's `onStart` sees everything spawned with it,
   * the rest of its prefab.
   */
  settle(): void {
    if (!this.started || this.arrived.length === 0) return;
    const arrived = this.arrived;
    this.arrived = [];
    const made: Behaviour[] = [];
    for (const { entityId, component } of arrived) {
      const behaviour = this.make(entityId, component);
      if (behaviour) made.push(behaviour);
    }
    for (const behaviour of made) behaviour.start?.();
  }

  /**
   * Its component left: deleted, or its entity destroyed. Taken down now,
   * while its object still hangs where it did — `onDestroy` reads it —, with
   * its claim and its listener, and out of its type's list.
   */
  unmount(entityId: EntityId, component: ComponentDoc): void {
    const waiting = this.waiting.get(entityId);
    waiting?.delete(component.id);
    if (waiting?.size === 0) this.waiting.delete(entityId);

    const ofEntity = this.made.get(entityId);
    const made = ofEntity?.get(component.id);
    if (ofEntity === undefined || made === undefined) return;
    ofEntity.delete(component.id);
    if (ofEntity.size === 0) this.made.delete(entityId);
    made.behaviour.dispose?.();
    for (const holding of made.held) holding.dispose();
    const at = this.all.indexOf(made.behaviour);
    if (at >= 0) this.all.splice(at, 1);
    this.counts[made.type] = (this.counts[made.type] ?? 1) - 1;
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
    for (const ofEntity of this.made.values()) {
      for (const { held } of ofEntity.values()) for (const holding of held) holding.dispose();
    }
    this.made.clear();
  }

  /**
   * The behaviour of one component, made on its entity's object and filed at
   * the end of its type's run; `null` for a component its type declines.
   */
  private make(entityId: EntityId, component: ComponentDoc): Behaviour | null {
    const definition = this.registry.get(component.type);
    const type = this.typeOf.get(component.type);
    const entity = this.world.document.entities.get(entityId);
    const object = this.world.binder.getObject(entityId);
    if (!definition || type === undefined || !entity || !object) return null;

    const behaviour = definition.create({ entity, object, component }, this.world);
    if (!behaviour) return null;

    const held: Disposable[] = [];
    // Over the scene's own cameras: what drives the view is the view you are
    // in. The first of two drivers wins, and is said.
    if (behaviour.camera) {
      this.drivers += 1;
      held.push(this.world.cameras.claim(behaviour.camera, CAMERA_PRIORITY.driven));
    }
    // What its entity's colliders touch, and those of the children riding its
    // body when it is a body's: physics publishes to both.
    if (this.collisions && listens(behaviour)) {
      held.push(this.collisions.listen(entityId, (touch) => hear(behaviour, touch)));
    }

    // The end of its type's run: past every behaviour of its type and of
    // those registered before it.
    let at = 0;
    for (let t = 0; t <= type; t += 1) at += this.counts[t] ?? 0;
    this.all.splice(at, 0, behaviour);
    this.counts[type] = (this.counts[type] ?? 0) + 1;
    const ofEntity = this.made.get(entityId);
    if (ofEntity) ofEntity.set(component.id, { behaviour, type, held });
    else this.made.set(entityId, new Map([[component.id, { behaviour, type, held }]]));
    return behaviour;
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
 * Unguarded, as `update` is: a behaviour guards its own hooks. A script hears
 * its own through physics' contribution to scripts, not through here.
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
