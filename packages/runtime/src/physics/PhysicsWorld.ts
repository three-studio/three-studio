import {
  colliderGeometry,
  componentsOfType,
  createColliderShape,
  entityWorldMatrixPath,
  findComponent,
  jointEnds,
  jointFrame,
  linkedPhysicsMaterial,
  physicsBodies,
  type BodyType,
  type BuiltShape,
  type ColliderComponent,
  type ColliderShape,
  type CombineRule,
  type EntityDoc,
  type JointComponent,
  type PhysicsMaterialDef,
  type PhysicsSettings,
  type RigidBodyComponent,
  type SceneDoc,
} from '@three-studio/core';
import RAPIER from '@dimforge/rapier3d-compat';
import { Euler, Matrix4, Quaternion, Vector3, type Object3D } from 'three/webgpu';
import type { SceneBinder } from '../SceneBinder';
import { Character } from './Character';
import { buildJoint, type Joint, type JointPose } from './joints';
import { collisionGroups, layerBits } from './layers';
import { describeMesh } from './meshShape';
import type {
  BodyHandle,
  CharacterController,
  CharacterSettings,
  Collision,
  JointHandle,
  PhysicsApi,
  QuatLike,
  QueryOptions,
  RaycastHit,
  Vec3Like,
} from './PhysicsApi';
import { isFiniteVec, unitQuat, unitVec } from './values';

/**
 * What moves a body: the solver, its entity's transform, a character controller
 * that took it, or nothing at all.
 *
 * Exactly one per body, set when the world is built and changed only when a
 * character controller takes the body. Two at once — a behaviour writing an
 * entity while the world copied its body back over it — is what once left fly
 * mode unable to move at all.
 */
type Driver = 'solver' | 'transform' | 'controller' | 'none';

/** Who drives a body of each type, until a character controller takes it. */
const DRIVER_OF: Record<RigidBodyComponent['bodyType'], Driver> = {
  dynamic: 'solver',
  kinematicPosition: 'transform',
  fixed: 'none',
};

/**
 * A body as the world keeps it: Rapier's, the collider its character would
 * sweep, its entity's object and its driver.
 */
class Body implements BodyHandle {
  /**
   * The object's local pose as the world last left it. Anything else there is
   * someone else's write.
   */
  private readonly written = { position: new Vector3(), quaternion: new Quaternion() };
  /** The body's world pose when the last tick began: where drawing between ticks starts. */
  private readonly previous = { position: new Vector3(), quaternion: new Quaternion() };
  /** A force or a torque was added since the last tick, for `afterTick` to drop. */
  private pushed = false;

  constructor(
    readonly rapier: RAPIER.RigidBody,
    /**
     * The one a character sweeps: the first collider of the body's own entity,
     * which `findComponent` returns and `PlayerController` measures its feet
     * from. `null` when the entity's colliders are all on its children, or it
     * has none.
     */
    readonly collider: RAPIER.Collider | null,
    /**
     * The entity's container, kept from the build. The binder creates it once,
     * and nothing syncs the binder while a game runs, so it is the entity's
     * object for the engine's life.
     */
    readonly object: Object3D,
    public driver: Driver,
    /**
     * The Rigid Body's `interpolate`. A character's body is drawn between ticks
     * whatever it says.
     */
    private readonly interpolate: boolean,
  ) {
    this.rememberWritten();
    this.rememberPrevious();
  }

  /**
   * Before each tick, once the behaviours' `fixedUpdate` has run.
   *
   * A kinematic body takes its object's world pose as its next target, so a
   * script or an animation moves it by moving its entity, and contacts carry
   * what rests on it. An object that stays still holds its body still.
   *
   * A body the solver or a character moves is put where its object is, if
   * someone wrote the object since the world did.
   *
   * A disabled body is left alone: whoever disabled it places its entity.
   */
  beforeTick(): void {
    if (this.driver === 'none' || !this.enabled) return;
    if (this.driver !== 'transform') {
      if (this.moved()) this.jumpToObject();
      if (this.smooth) this.rememberPrevious();
      return;
    }
    worldPose(this.object, _worldPosition, _worldQuaternion, _worldScale);
    this.rapier.setNextKinematicTranslation(_worldPosition);
    this.rapier.setNextKinematicRotation(_worldQuaternion);
  }

  /**
   * After each tick: the forces and torques added for it, dropped.
   *
   * Rapier keeps a force until it is reset, where Unity's and Godot's last one
   * tick. A force added in every `fixedUpdate`, as every engine's docs teach,
   * grew by one more push each tick, and 10 N added once was still pushing a
   * second later. Torques too: a force at a point adds one.
   */
  afterTick(): void {
    if (!this.pushed) return;
    this.rapier.resetForces(false);
    this.rapier.resetTorques(false);
    this.pushed = false;
  }

  /**
   * After the frame's ticks: the pose of a body the solver or a character
   * moves, onto its object.
   *
   * `alpha` is how far the clock has run into the next tick. A smooth body is
   * drawn that far from where its last tick began towards where it ended, so it
   * moves on every frame whatever the display's rate, up to a tick behind its
   * body.
   *
   * Not a kinematic body's: it follows its entity, which is where its script
   * put it. Drawn at its body, the body nothing had moved was written over the
   * script's move every frame, and a moving platform never left its place. Nor
   * a disabled body's, since whoever disabled it places its entity.
   */
  draw(alpha: number): void {
    if ((this.driver !== 'solver' && this.driver !== 'controller') || !this.enabled) return;
    // A frame with no tick still takes a write made in `onUpdate` or `onLateUpdate`.
    if (this.moved()) this.jumpToObject();

    const translation = this.rapier.translation();
    const rotation = this.rapier.rotation();
    _worldPosition.set(translation.x, translation.y, translation.z);
    _worldQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    if (this.smooth) {
      // Into scratches of their own. `slerpQuaternions(a, b, t)` copies `a` into
      // its target before it reads `b`, so `_worldQuaternion` as both would draw
      // `previous`: the aliasing that once drew every turning body unrotated.
      _drawnPosition.lerpVectors(this.previous.position, _worldPosition, alpha);
      _drawnQuaternion.slerpQuaternions(this.previous.quaternion, _worldQuaternion, alpha);
      applyWorldTransform(this.object, _drawnPosition, _drawnQuaternion);
    } else {
      applyWorldTransform(this.object, _worldPosition, _worldQuaternion);
    }
    this.rememberWritten();
  }

  /**
   * Drawn between its last two ticks. The player's camera rides a character's
   * body, which always is.
   */
  private get smooth(): boolean {
    return this.driver === 'controller' || this.interpolate;
  }

  /**
   * Whether someone wrote the object since the world did.
   *
   * Exact, on purpose. The world keeps what it put there, so the same numbers
   * stay until someone writes, and its own write never reads as a script's; a
   * tolerance would let a small write through as none. A write through
   * `rotation` reaches `quaternion`, which three keeps in step. `scale` is not
   * compared: a collider keeps the size it was built with.
   */
  private moved(): boolean {
    return (
      !this.object.position.equals(this.written.position) ||
      !this.object.quaternion.equals(this.written.quaternion)
    );
  }

  /**
   * The body put at its object's pose, rotation included, its velocities kept:
   * a respawn keeps the fall it had. On a character's body it also replaces the
   * move its controller made this tick, so the respawn wins over the step.
   */
  private jumpToObject(): void {
    worldPose(this.object, _worldPosition, _worldQuaternion, _worldScale);
    this.rapier.setTranslation(_worldPosition, true);
    this.rapier.setRotation(_worldQuaternion, true);
    // From there, rather than drawn sweeping from where it was.
    this.rememberPrevious();
    this.rememberWritten();
  }

  private rememberWritten(): void {
    this.written.position.copy(this.object.position);
    this.written.quaternion.copy(this.object.quaternion);
  }

  private rememberPrevious(): void {
    this.previous.position.copy(this.rapier.translation());
    this.previous.quaternion.copy(this.rapier.rotation());
  }

  // Rapier hands back a fresh object on every read, which is the copy the API
  // promises.
  get position(): Readonly<Vec3Like> {
    return this.rapier.translation();
  }

  get rotation(): Readonly<QuatLike> {
    return this.rapier.rotation();
  }

  get enabled(): boolean {
    return this.rapier.isEnabled();
  }

  /** Rapier disables the body's colliders with it, which is what holds it out of the world. */
  set enabled(enabled: boolean) {
    this.rapier.setEnabled(enabled);
  }

  get mass(): number {
    return this.rapier.mass();
  }

  get linearVelocity(): Readonly<Vec3Like> {
    return this.rapier.linvel();
  }

  set linearVelocity(velocity: Readonly<Vec3Like>) {
    if (isFiniteVec(velocity)) this.rapier.setLinvel(velocity, true);
  }

  get angularVelocity(): Readonly<Vec3Like> {
    return this.rapier.angvel();
  }

  set angularVelocity(velocity: Readonly<Vec3Like>) {
    if (isFiniteVec(velocity)) this.rapier.setAngvel(velocity, true);
  }

  addForce(force: Readonly<Vec3Like>, at?: Readonly<Vec3Like>): void {
    if (!isFiniteVec(force) || (at && !isFiniteVec(at))) return;
    if (at) this.rapier.addForceAtPoint(force, at, true);
    else this.rapier.addForce(force, true);
    this.pushed = true;
  }

  applyImpulse(impulse: Readonly<Vec3Like>, at?: Readonly<Vec3Like>): void {
    if (!isFiniteVec(impulse) || (at && !isFiniteVec(at))) return;
    if (at) this.rapier.applyImpulseAtPoint(impulse, at, true);
    else this.rapier.applyImpulse(impulse, true);
  }

  addTorque(torque: Readonly<Vec3Like>): void {
    if (!isFiniteVec(torque)) return;
    this.rapier.addTorque(torque, true);
    this.pushed = true;
  }

  applyTorqueImpulse(impulse: Readonly<Vec3Like>): void {
    if (isFiniteVec(impulse)) this.rapier.applyTorqueImpulse(impulse, true);
  }

  /**
   * The body and its object put there together, whatever drives the body.
   *
   * The object too. A kinematic body follows it at the next tick, and left
   * where it was it pulled the body back, flinging what rested on it at the
   * speed of the pull. Its `previous` and `written` take the pose as well, so
   * the body is not drawn sweeping in from where it was, and the move does not
   * read as a script's write.
   */
  teleport(position: Readonly<Vec3Like>, rotation?: Readonly<QuatLike>): void {
    const turn = rotation ? unitQuat(rotation) : undefined;
    if (turn === null || !isFiniteVec(position)) return;

    _worldPosition.set(position.x, position.y, position.z);
    this.rapier.setTranslation(_worldPosition, true);
    this.previous.position.copy(_worldPosition);
    if (turn) {
      _worldQuaternion.set(turn.x, turn.y, turn.z, turn.w);
      this.rapier.setRotation(_worldQuaternion, true);
      this.previous.quaternion.copy(_worldQuaternion);
    }
    applyWorldTransform(this.object, _worldPosition, turn ? _worldQuaternion : undefined);
    this.rememberWritten();
  }
}

/** No turn: a sphere's, and a box overlap's when it is given none. */
const IDENTITY: Readonly<QuatLike> = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

const _worldPosition = new Vector3();
const _worldQuaternion = new Quaternion();
const _drawnPosition = new Vector3();
const _drawnQuaternion = new Quaternion();
const _parentQuaternion = new Quaternion();
const _worldScale = new Vector3();
const _parentInverse = new Matrix4();
const _carrierPosition = new Vector3();
const _carrierQuaternion = new Quaternion();
const _carrierScale = new Vector3();
const _frame: Frame = { position: new Vector3(), quaternion: new Quaternion() };
const _colliderEuler = new Euler();
const _colliderRotation = new Quaternion();
const _colliderPosition = new Vector3();

/** A pose on a body, in its frame. */
interface Frame {
  readonly position: Vector3;
  readonly quaternion: Quaternion;
}

/** An entity whose colliders a body carries: its id, its object, and its colliders. */
interface Carrier {
  readonly entityId: string;
  readonly object: Object3D;
  readonly colliders: readonly ColliderComponent[];
}

/** The entity a collider was built from, and the entity whose body it rides: the same one on its own body. */
export interface ColliderOwner {
  readonly entity: string;
  readonly body: string;
}

/**
 * Two colliders that started or stopped touching in a tick, by entity, named
 * after the hook that hears it: Rapier's handles stay in this module. A
 * trigger is a pair with a sensor in it, an overlap with no contact to
 * describe.
 */
export type PhysicsEvent = { readonly a: ColliderOwner; readonly b: ColliderOwner } & (
  | {
      readonly kind: 'collisionEnter';
      /** Seen from `a`: `b` is pushed the other way. */
      readonly contact: Omit<Collision, 'other'>;
    }
  | { readonly kind: 'collisionExit' | 'triggerEnter' | 'triggerExit' }
);

/**
 * What Rapier's debug view draws: line segments, two points of three floats
 * each in `vertices`, and an RGBA colour of four floats per point in `colors` —
 * Rapier's own, which tell fixed, dynamic and kinematic bodies apart and dim a
 * sleeping one.
 */
export interface DebugLines {
  readonly vertices: Float32Array;
  readonly colors: Float32Array;
}

/** A collider the world built, as an event names it. */
interface Built {
  readonly owner: ColliderOwner;
  readonly sensor: boolean;
  readonly collider: RAPIER.Collider;
}

/** What a query sees, as the arguments every Rapier query ends with. */
type Scope = [
  flags: RAPIER.QueryFilterFlags | undefined,
  groups: undefined,
  excludeCollider: undefined,
  excludeBody: RAPIER.RigidBody | undefined,
  predicate: (collider: RAPIER.Collider) => boolean,
];

/**
 * Owns the Rapier world and keeps it in step with the scene document.
 *
 * Bodies are built from the *bound* three.js objects rather than from the
 * document's local transforms, so entity nesting is handled for free: the
 * object already carries its resolved world matrix.
 *
 * Two faces. The lifecycle — `create`, `build`, `step`, `writeBack`, `dispose`
 * — is the `Engine`'s alone. `PhysicsApi` is what behaviours are handed, and
 * nothing of Rapier's crosses it.
 */
export class PhysicsWorld implements PhysicsApi {
  readonly gravity: Readonly<Vec3Like>;
  readonly layers: readonly Readonly<{ id: string; name: string }>[];
  private readonly world: RAPIER.World;
  private readonly bodies = new Map<string, Body>();
  /** Drained before each step, so the events of a world nobody listens to cannot pile up. */
  private readonly events = new RAPIER.EventQueue(true);
  /**
   * Each collider's entity and body, by Rapier's handle: an event names two
   * handles, and no handle leaves this module. Whatever builds a collider
   * registers it here, or nothing it touches is ever heard.
   */
  private readonly owners = new Map<number, Built>();
  /** What touched when the world was built, for the first tick to hand out before its own. */
  private atBuild: PhysicsEvent[] = [];
  /** What a joint with no Connected Body is held to; made by the first one. */
  private groundBody: RAPIER.RigidBody | null = null;
  /**
   * Each joint built, by the entity carrying it. The first only, should a
   * hand-edited file give an entity two: the Inspector adds one.
   */
  private readonly joints = new Map<string, Joint>();
  private accumulator = 0;
  /** Moves with each tick: the debug view read at a version holds until it moves. */
  private version = 0;
  private debug: { readonly version: number; readonly lines: DebugLines } | null = null;

  private readonly fixedStep: number;
  private readonly maxSubsteps: number;
  /** Each layer's collision groups, by its id: project data, as gravity and the step are. */
  private readonly groupsOf: (layerId: string) => number;
  /** The bits of the layers a query asks for, by their ids. */
  private readonly bitsOf: (layerIds: readonly string[]) => number;

  private constructor(world: RAPIER.World, settings: PhysicsSettings) {
    this.fixedStep = settings.fixedTimestep;
    this.maxSubsteps = settings.maxSubsteps;
    this.groupsOf = collisionGroups(settings.layers);
    this.bitsOf = layerBits(settings.layers);
    const [x, y, z] = settings.gravity;
    this.gravity = Object.freeze({ x, y, z });
    // Without what each ignores, which is the matrix's business.
    this.layers = Object.freeze(settings.layers.map(({ id, name }) => Object.freeze({ id, name })));
    this.world = world;
    this.world.timestep = this.fixedStep;
  }

  /**
   * Rapier is WebAssembly and must be initialised before any API is touched.
   * The `-compat` build inlines the module, so there is no extra file to serve.
   *
   * The settings are required, and the world has no defaults of its own: they
   * were a second copy of `createPhysicsSettings()`, and the copy the editor's
   * Step read, so it advanced 1/60 whatever step the project had chosen.
   */
  static async create(settings: PhysicsSettings): Promise<PhysicsWorld> {
    await RAPIER.init();
    const [x, y, z] = settings.gravity;
    return new PhysicsWorld(new RAPIER.World({ x, y, z }), settings);
  }

  /**
   * Creates a body for every Rigid Body, and for every collider with none above
   * it, each carrying the colliders that ride it (`physicsBodies`).
   *
   * Driven by the two component tables rather than by a walk of the entity
   * table: a scene of two thousand props with a dozen physical objects in it
   * visits the dozen.
   *
   * `materials` are the project's physics materials by asset id, which a
   * collider linking one is built with. Read here and not kept: they belong to
   * the build, as the scene does.
   */
  build(
    scene: SceneDoc,
    binder: SceneBinder,
    materials: Readonly<Record<string, PhysicsMaterialDef>> = {},
  ): void {
    const bodies = physicsBodies(scene);
    const colliders = componentsOfType(scene, 'collider');

    // Parents first, because `writeBack` writes the bodies in the order they
    // were added. A child written before its parent was placed against the pose
    // its parent was about to leave, and drawn a frame of its parent's motion
    // off its own body. `sort` is stable, so siblings keep their table order.
    const parentsFirst = [...bodies.keys()]
      .map((entityId) => ({ entityId, depth: entityWorldMatrixPath(scene, entityId).length }))
      .sort((a, b) => a.depth - b.depth);

    for (const { entityId } of parentsFirst) {
      const entity = scene.entities[entityId];
      if (!entity) continue;

      const object = binder.getObject(entityId);
      if (!object) continue;

      const carriers = (bodies.get(entityId) ?? []).flatMap((carrierId): Carrier[] => {
        const carrier = binder.getObject(carrierId);
        return carrier
          ? [{ entityId: carrierId, object: carrier, colliders: Object.values(colliders[carrierId] ?? {}) }]
          : [];
      });
      const rigidbody = findComponent(scene, entityId, 'rigidbody');
      this.addBody(entity, object, rigidbody, carriers, materials);
    }

    // After the bodies, two of which each joint holds, and before the step of
    // no time, which moves nothing with joints built either. One that holds
    // nothing is left out, and the Engine says why.
    for (const [entityId, held] of Object.entries(componentsOfType(scene, 'joint'))) {
      for (const joint of Object.values(held)) {
        const ends = jointEnds(scene, entityId, joint);
        if (!ends.holds) continue;
        const own = this.bodies.get(ends.own)?.rapier;
        const other = ends.other === null ? this.ground() : this.bodies.get(ends.other)?.rapier;
        const object = binder.getObject(entityId);
        if (!own || !other || !object) continue;
        const built = buildJoint(this.world, joint, other, own, jointPose(object, joint));
        if (!this.joints.has(entityId)) this.joints.set(entityId, built);
      }
    }

    // A step of no time, so that a query sees the scene from the start. Rapier
    // files colliders for its queries as it steps, and a world not yet stepped
    // answered none: a script placing itself on the ground in `onStart`, or
    // asking at its first tick, met nothing. It moves nothing — a ball resting
    // on the ground kept its place and no speed, two boxes built into each
    // other stayed where they were — and reports as started what touches
    // already, which no tick reports again: the first tick hands that out,
    // after every `onStart`, when it was heard before.
    this.world.timestep = 0;
    this.world.step(this.events);
    this.world.timestep = this.fixedStep;
    this.atBuild = this.drain();
  }

  /**
   * Advances the simulation, consuming whole fixed steps.
   *
   * A variable step would make a stack of boxes settle differently on a 60 Hz
   * and a 144 Hz display, and makes jump heights frame-rate dependent.
   *
   * @param beforeStep Runs immediately before each step, with the fixed delta.
   *   Anything that commands a kinematic body belongs here: `setNextKinematic*`
   *   is a target, not an impulse, so a caller running at display rate would
   *   overwrite its own commands between steps and lose most of the motion.
   * @param afterStep Runs after each step, with what started or stopped
   *   touching in it — the first step also with what touched when the world
   *   was built —, once the step's forces are dropped: a force added then is
   *   felt in the next step, and a kick at once.
   */
  step(
    delta: number,
    beforeStep?: (fixedDelta: number) => void,
    afterStep?: (events: readonly PhysicsEvent[]) => void,
  ): void {
    this.accumulator += Math.min(delta, this.fixedStep * this.maxSubsteps);

    let steps = 0;
    while (this.accumulator >= this.fixedStep && steps < this.maxSubsteps) {
      beforeStep?.(this.fixedStep);
      // After the behaviours, so a body follows where they put its entity this tick.
      for (const body of this.bodies.values()) body.beforeTick();
      this.world.step(this.events);
      this.version += 1;
      for (const body of this.bodies.values()) body.afterTick();
      const events = this.atBuild.concat(this.drain());
      this.atBuild = [];
      afterStep?.(events);
      this.accumulator -= this.fixedStep;
      steps += 1;
    }
  }

  /**
   * Draws the bodies onto their entities once the frame's ticks have run, in
   * the order they were built: parents first.
   *
   * The step runs at the project's rate and the screen at its own. Drawn at its
   * last tick, a body stood still on every other frame at 120 Hz, and on three
   * frames out of four at a quarter of the time scale. A body that asks is
   * drawn between its last two ticks instead.
   */
  writeBack(): void {
    // Below one: `step` takes in no more time than the ticks it may run, and runs them.
    const alpha = this.accumulator / this.fixedStep;
    for (const body of this.bodies.values()) body.draw(alpha);
  }

  /**
   * Rapier's debug view as of the last tick: every collider as the solver holds
   * it, each body's axes, each joint.
   *
   * Read once per tick, and handed again until the next. Rapier hands two new
   * arrays per read, 840 KB in 0.7 ms for a thousand boxes, so a view drawn at
   * the display's rate, or over a paused game, reads them once.
   *
   * A body held out of the world — a flying player's, any disabled one — was
   * drawn where it was left. Its colliders read disabled, and leaving them out
   * takes its axes with them.
   */
  debugLines(): DebugLines {
    if (this.debug === null || this.debug.version !== this.version) {
      const { vertices, colors } = this.world.debugRender(undefined, (collider) => collider.isEnabled());
      this.debug = { version: this.version, lines: { vertices, colors } };
    }
    return this.debug.lines;
  }

  body(entityId: string): BodyHandle | null {
    return this.bodies.get(entityId) ?? null;
  }

  joint(entityId: string): JointHandle | null {
    return this.joints.get(entityId) ?? null;
  }

  createCharacterController(
    entityId: string,
    settings: CharacterSettings,
  ): CharacterController | null {
    const body = this.bodies.get(entityId);
    // One driver to a body: a second controller would set its target on every
    // tick too, and whichever moved it last would win, silently.
    if (!body?.collider || body.driver === 'controller') return null;
    // The world writes this body to its entity from now on, as it writes every
    // other, so the character is placed in the same parents-first pass.
    body.driver = 'controller';
    // Kinematic whatever its component says, so the character is its only
    // driver. Add Component makes kinematic only the body it brings itself, and
    // a Rigid Body added before the Player Controller stayed Dynamic: the solver
    // drove it, the character's targets moved nothing, and the player stood still.
    body.rapier.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    return new Character(
      this.world.createCharacterController(settings.offset),
      body.rapier,
      body.collider,
      settings,
    );
  }

  raycast(
    origin: Readonly<Vec3Like>,
    direction: Readonly<Vec3Like>,
    maxDistance: number,
    options?: QueryOptions,
  ): RaycastHit | null {
    // Unit, so that a distance in or out is in metres: Rapier counts it in
    // lengths of the direction, and read 2.25 for a face 4.5 m along (0, 0, −2).
    const unit = unitVec(direction);
    // A NaN fails every comparison, so `>= 0` refuses it too.
    if (!unit || !isFiniteVec(origin) || !(maxDistance >= 0)) return null;
    const ray = new RAPIER.Ray(origin, unit);
    // Solid or hollow tells only what a ray does inside a collider, and one
    // holding the origin is left out.
    const hit = this.world.castRayAndGetNormal(
      ray,
      maxDistance,
      true,
      ...this.scope(options, (collider) => collider.containsPoint(origin)),
    );
    const met = hit && this.owners.get(hit.collider.handle);
    if (!hit || !met) return null;
    const { x, y, z } = hit.normal;
    return {
      entity: met.owner.entity,
      point: ray.pointAt(hit.timeOfImpact),
      normal: { x, y, z },
      distance: hit.timeOfImpact,
    };
  }

  sphereCast(
    origin: Readonly<Vec3Like>,
    radius: number,
    direction: Readonly<Vec3Like>,
    maxDistance: number,
    options?: QueryOptions,
  ): RaycastHit | null {
    if (!Number.isFinite(radius)) return null;
    return this.cast({ ...createColliderShape('sphere'), radius }, origin, IDENTITY, direction, maxDistance, options);
  }

  boxCast(
    origin: Readonly<Vec3Like>,
    size: Readonly<Vec3Like>,
    rotation: Readonly<QuatLike>,
    direction: Readonly<Vec3Like>,
    maxDistance: number,
    options?: QueryOptions,
  ): RaycastHit | null {
    if (!isFiniteVec(size)) return null;
    const box: ColliderShape = { ...createColliderShape('box'), size: [size.x, size.y, size.z] };
    return this.cast(box, origin, rotation, direction, maxDistance, options);
  }

  capsuleCast(
    origin: Readonly<Vec3Like>,
    radius: number,
    height: number,
    rotation: Readonly<QuatLike>,
    direction: Readonly<Vec3Like>,
    maxDistance: number,
    options?: QueryOptions,
  ): RaycastHit | null {
    if (!Number.isFinite(radius) || !Number.isFinite(height)) return null;
    const capsule = { ...createColliderShape('capsule'), radius, height };
    return this.cast(capsule, origin, rotation, direction, maxDistance, options);
  }

  overlapSphere(center: Readonly<Vec3Like>, radius: number, options?: QueryOptions): readonly string[] {
    if (!Number.isFinite(radius)) return [];
    return this.overlap({ ...createColliderShape('sphere'), radius }, center, IDENTITY, options);
  }

  overlapBox(
    center: Readonly<Vec3Like>,
    size: Readonly<Vec3Like>,
    rotation: Readonly<QuatLike> = IDENTITY,
    options?: QueryOptions,
  ): readonly string[] {
    if (!isFiniteVec(size)) return [];
    const box: ColliderShape = { ...createColliderShape('box'), size: [size.x, size.y, size.z] };
    return this.overlap(box, center, rotation, options);
  }

  /**
   * The world a joint with no Connected Body is held to: one fixed body at the
   * origin, with no collider. No entity owns it, so `body()` never answers
   * with it.
   */
  private ground(): RAPIER.RigidBody {
    this.groundBody ??= this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    return this.groundBody;
  }

  dispose(): void {
    this.bodies.clear();
    this.joints.clear();
    this.owners.clear();
    // Rapier says a queue must be freed by hand, and `world.free()` leaves it.
    this.events.free();
    this.world.free();
  }

  /**
   * The tick's events, by entity.
   *
   * Rapier's queue is read whole before the world is asked where any pair
   * touches, so nothing calls into Rapier from inside its own loop.
   */
  private drain(): PhysicsEvent[] {
    const pairs: { first: number; second: number; started: boolean }[] = [];
    this.events.drainCollisionEvents((first, second, started) => {
      pairs.push({ first, second, started });
    });
    return pairs.flatMap(({ first, second, started }): PhysicsEvent[] => {
      const a = this.owners.get(first);
      const b = this.owners.get(second);
      // Every collider the world builds is in the table.
      if (!a || !b) return [];
      const sides = { a: a.owner, b: b.owner };
      if (a.sensor || b.sensor) return [{ ...sides, kind: started ? 'triggerEnter' : 'triggerExit' }];
      if (!started) return [{ ...sides, kind: 'collisionExit' }];
      return [{ ...sides, kind: 'collisionEnter', contact: this.contactOf(a.collider, b.collider) }];
    });
  }

  /**
   * Where two colliders that have just begun touching touch, seen from `first`.
   *
   * Rapier starts a collision when the pair gains a solver contact, so there is
   * one to read: a ball landing touches at one point, under it; a box landing
   * flat at four, whose middle is its face's centre. A manifold's normal points
   * out of its first collider, which is `second` when Rapier holds the pair the
   * other way round (`flipped`), and `first` is pushed along the one out of
   * `second`. The impulse is what held them apart through the tick: a 2 kg
   * ball landing at 5.4 m/s read 11.12 N·s, its m·v and its weight over the
   * tick.
   */
  private contactOf(first: RAPIER.Collider, second: RAPIER.Collider): Omit<Collision, 'other'> {
    const points: Vec3Like[] = [];
    const normals: Vec3Like[] = [];
    let impulse = 0;
    this.world.contactPair(first, second, (manifold, flipped) => {
      for (let i = 0; i < manifold.numContacts(); i++) impulse += manifold.contactImpulse(i);
      const touching = manifold.numSolverContacts();
      for (let i = 0; i < touching; i++) {
        const point = manifold.solverContactPoint(i);
        if (point) points.push(point);
      }
      if (touching === 0) return;
      const n = manifold.normal();
      normals.push(flipped ? n : { x: -n.x, y: -n.y, z: -n.z });
    });
    // Never taken, a collision starting with a solver contact; here so that no
    // NaN can leave this module.
    if (points.length === 0) points.push(first.translation(), second.translation());
    const sum = points.reduce(
      (total, p) => ({ x: total.x + p.x, y: total.y + p.y, z: total.z + p.z }),
      { x: 0, y: 0, z: 0 },
    );
    const count = points.length;
    return {
      point: { x: sum.x / count, y: sum.y / count, z: sum.z / count },
      normal: normals[0] ?? { x: 0, y: 1, z: 0 },
      impulse,
    };
  }

  /**
   * What a query sees: the colliders on the layers it asks for, by each
   * collider's own layer, as Unity's and Godot's do, whatever the matrix says;
   * sensors only when it asks, so that a ray of sight passes through a trigger
   * zone; never the body it is told to leave out, nor what it starts in.
   *
   * Only colliders the world built, so that a hit can name its entity: one
   * missing from the table is passed over, and the next one found.
   *
   * A ray or a cast passes out of what it starts in, as Unity's and Godot's
   * do: it reports what it runs into, where an overlap says what is there.
   * Rapier's ray met the box it started inside at 0, facing nowhere, and a ray
   * along the ground's top face the ground, at 0; with what holds the origin
   * left out, each went on to the wall ahead.
   *
   * Rapier leaves out every collider of the body it is handed, so a compound
   * caller is left out whole.
   */
  private scope(options: QueryOptions | undefined, startsIn: (collider: RAPIER.Collider) => boolean): Scope {
    const excluded = options?.exclude === undefined ? undefined : this.bodies.get(options.exclude)?.rapier;
    const bits = options?.layers === undefined ? undefined : this.bitsOf(options.layers);
    return [
      options?.sensors ? undefined : RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      // No groups. Rapier tests a query's both ways, as between two colliders,
      // and hid a collider whose layer touches nothing from every query
      // whatever it asked for; so the predicate reads the collider's own bit.
      undefined,
      undefined,
      excluded,
      (collider) =>
        this.owners.has(collider.handle) &&
        (bits === undefined || ((collider.collisionGroups() >>> 16) & bits) !== 0) &&
        !startsIn(collider),
    ];
  }

  /**
   * The nearest collider a shape meets, swept from `origin` along `direction`.
   *
   * Passing out of what it starts touching: a ball resting on the ground, cast
   * along it, met the ground 4 mm on, its normal 45° off, and went on to the
   * wall once the ground was left out. With that left out it penetrates
   * nothing where it starts, so stopping at a penetration changes nothing.
   */
  private cast(
    shape: ColliderShape,
    origin: Readonly<Vec3Like>,
    rotation: Readonly<QuatLike>,
    direction: Readonly<Vec3Like>,
    maxDistance: number,
    options: QueryOptions | undefined,
  ): RaycastHit | null {
    const turn = unitQuat(rotation);
    // Unit, for metres, as a ray's.
    const unit = unitVec(direction);
    const swept = queryShape(shape);
    if (!turn || !unit || !swept || !isFiniteVec(origin) || !(maxDistance >= 0)) return null;
    const hit = this.world.castShape(
      origin,
      turn,
      unit,
      swept,
      0,
      maxDistance,
      true,
      ...this.scope(options, (collider) => collider.intersectsShape(swept, origin, turn)),
    );
    const met = hit && this.owners.get(hit.collider.handle);
    if (!hit || !met) return null;
    // On the collider met, in world space, though Rapier's doc says its own
    // frame: a wall's face 4.5 m ahead read (0, 1, −4.5), where it stands.
    const { witness1: point, normal1: normal } = hit;
    return {
      entity: met.owner.entity,
      point: { x: point.x, y: point.y, z: point.z },
      normal: { x: normal.x, y: normal.y, z: normal.z },
      distance: hit.time_of_impact,
    };
  }

  /** The entities whose colliders a shape holds or touches, each once. What it starts in is what it asks about. */
  private overlap(
    shape: ColliderShape,
    center: Readonly<Vec3Like>,
    rotation: Readonly<QuatLike>,
    options: QueryOptions | undefined,
  ): readonly string[] {
    const turn = unitQuat(rotation);
    const held = queryShape(shape);
    if (!turn || !held || !isFiniteVec(center)) return [];
    // An entity's two colliders in it are one entity.
    const found = new Set<string>();
    this.world.intersectionsWithShape(
      center,
      turn,
      held,
      (collider) => {
        const met = this.owners.get(collider.handle);
        if (met) found.add(met.owner.entity);
        return true;
      },
      ...this.scope(options, () => false),
    );
    return [...found];
  }

  private addBody(
    entity: EntityDoc,
    object: Object3D,
    rigidbody: RigidBodyComponent | undefined,
    carriers: readonly Carrier[],
    materials: Readonly<Record<string, PhysicsMaterialDef>>,
  ): void {
    worldPose(object, _worldPosition, _worldQuaternion, _worldScale);

    // A collider with no rigid body is level geometry: static, and free.
    const bodyType = rigidbody?.bodyType ?? 'fixed';
    const desc = describeBody(bodyType)
      .setTranslation(_worldPosition.x, _worldPosition.y, _worldPosition.z)
      .setRotation({
        x: _worldQuaternion.x,
        y: _worldQuaternion.y,
        z: _worldQuaternion.z,
        w: _worldQuaternion.w,
      });

    if (rigidbody) {
      desc.setLinearDamping(rigidbody.linearDamping);
      desc.setAngularDamping(rigidbody.angularDamping);
      desc.setGravityScale(rigidbody.gravityScale);
      desc.setCcdEnabled(rigidbody.ccd);
      // The solver's alone, as the Inspector shows them: a kinematic body never
      // takes a lock hidden since it stopped being dynamic. Rapier names the
      // axes left free, where the document names those locked.
      if (bodyType === 'dynamic') {
        const [px, py, pz] = rigidbody.lockPosition;
        const [rx, ry, rz] = rigidbody.lockRotation;
        desc.enabledTranslations(!px, !py, !pz);
        desc.enabledRotations(!rx, !ry, !rz);
      }
    }

    const body = this.world.createRigidBody(desc);

    const created: RAPIER.Collider[] = [];
    let own: RAPIER.Collider | null = null;
    for (const carrier of carriers) {
      const isOwn = carrier.object === object;
      if (isOwn) {
        _frame.position.set(0, 0, 0);
        _frame.quaternion.identity();
        _carrierScale.copy(_worldScale);
      } else {
        // Its place on the body, fixed from here on: q_B⁻¹ · q_C, at
        // q_B⁻¹ · (p_C − p_B).
        worldPose(carrier.object, _carrierPosition, _carrierQuaternion, _carrierScale);
        _frame.quaternion.copy(_worldQuaternion).invert();
        _frame.position.copy(_carrierPosition).sub(_worldPosition).applyQuaternion(_frame.quaternion);
        _frame.quaternion.multiply(_carrierQuaternion);
      }

      const owner: ColliderOwner = { entity: carrier.entityId, body: entity.id };
      for (const collider of carrier.colliders) {
        const shape = describeCollider(collider, carrier.object, _carrierScale, bodyType, _frame);
        // A link the project cannot answer plays its own values, as an
        // unlinked collider does; the Engine says so.
        const material = linkedPhysicsMaterial(collider.materialId, materials) ?? collider.material;
        shape.setFriction(material.friction);
        shape.setRestitution(material.restitution);
        shape.setFrictionCombineRule(COMBINE_RULES[material.frictionCombine]);
        shape.setRestitutionCombineRule(COMBINE_RULES[material.restitutionCombine]);
        shape.setSensor(collider.isSensor);
        // Every collider, not the sensors alone: one matrix decides what
        // touches, what a sensor sees and what a character sweeps, its
        // collider's groups being its sweep's filter. Rapier tests the groups
        // beside a sensor's active types, not instead of them: a fixed sensor
        // with the kinematic pairs below saw nothing on a layer its own ignores.
        shape.setCollisionGroups(this.groupsOf(collider.layer));
        // Every collider asks. Rapier reports a pair when either side does, so
        // what a pair reports never depends on which side asked; and only when
        // it changes, so a scene at rest reports nothing.
        shape.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
        if (collider.isSensor) shape.setActiveCollisionTypes(SENSOR_PAIRS);
        const built = this.world.createCollider(shape, body);
        this.owners.set(built.handle, { owner, sensor: collider.isSensor, collider: built });
        created.push(built);
        if (isOwn) own ??= built;
      }
    }
    if (rigidbody) weigh(body, created, rigidbody.mass);

    this.bodies.set(
      entity.id,
      new Body(body, own, object, DRIVER_OF[bodyType], rigidbody?.interpolate ?? false),
    );
  }
}

/** Each rule as Rapier names it. */
const COMBINE_RULES: Record<CombineRule, RAPIER.CoefficientCombineRule> = {
  average: RAPIER.CoefficientCombineRule.Average,
  min: RAPIER.CoefficientCombineRule.Min,
  multiply: RAPIER.CoefficientCombineRule.Multiply,
  max: RAPIER.CoefficientCombineRule.Max,
};

/**
 * The pairs a sensor is checked in: Rapier's default ones, which need a
 * dynamic body on one side, and a kinematic body meeting a fixed or another
 * kinematic one. With the default alone a fixed sensor never saw the player,
 * whose body is kinematic, walk through it. So a trigger sees whatever moves —
 * the player, a script's character, a moving platform —, as in Unity's matrix,
 * and two fixed colliders still never meet.
 */
const SENSOR_PAIRS =
  RAPIER.ActiveCollisionTypes.DEFAULT |
  RAPIER.ActiveCollisionTypes.KINEMATIC_FIXED |
  RAPIER.ActiveCollisionTypes.KINEMATIC_KINEMATIC;

/**
 * A body given its Rigid Body's mass, shared out among its colliders.
 *
 * At one density over the solid ones, so its centre of mass is their volumes'
 * centroid and its inertia a uniform solid's, as Unity computes them. A sensor
 * weighs nothing: it is a zone, not matter, and one reaching out to a side,
 * weighed as Rapier weighs it, tipped its body over. PhysX leaves trigger shapes
 * out of a body's mass too.
 *
 * With no solid volume to share it — no collider, sensors alone, a flat hull —
 * the body takes the mass whole: Rapier lets a dynamic body nothing weighs
 * ignore gravity, and a Rigid Body with no collider hung where it was built.
 * Only then, because Rapier spreads a body's own mass over every shape on it,
 * sensors included.
 *
 * A rounded shape weighs by its core, as Rapier measures its volume; the total
 * stays exact.
 */
function weigh(body: RAPIER.RigidBody, colliders: readonly RAPIER.Collider[], mass: number): void {
  const solid = colliders.filter((collider) => !collider.isSensor());
  const volume = solid.reduce((sum, collider) => sum + collider.volume(), 0);
  const shared = volume > 0;
  for (const collider of colliders) {
    collider.setDensity(shared && !collider.isSensor() ? mass / volume : 0);
  }
  if (!shared) body.setAdditionalMass(mass, true);
  // A density set on a built collider reaches its body at the next step, and
  // `mass` read before it gave the old one.
  body.recomputeMassPropertiesFromColliders();
}

function describeBody(kind: RigidBodyComponent['bodyType']): RAPIER.RigidBodyDesc {
  switch (kind) {
    case 'dynamic':
      return RAPIER.RigidBodyDesc.dynamic();
    case 'kinematicPosition':
      return RAPIER.RigidBodyDesc.kinematicPositionBased();
    case 'fixed':
      return RAPIER.RigidBodyDesc.fixed();
  }
}

/**
 * A collider as Rapier takes it, built at its entity's world scale by the rules
 * core's `colliderGeometry` writes down for the type of the body it rides, and
 * set off and turned on that body: by its own centre and rotation, carried
 * through its entity's frame on the body.
 */
function describeCollider(
  collider: ColliderComponent,
  object: Object3D,
  scale: Vector3,
  bodyType: BodyType,
  frame: Frame,
): RAPIER.ColliderDesc {
  const { x: sx, y: sy, z: sz } = scale;
  const { shape, position, rotation } = colliderGeometry(collider.shape, [sx, sy, sz], bodyType);
  _colliderPosition.set(...position).applyQuaternion(frame.quaternion).add(frame.position);
  // three's Euler XYZ, which is the order `colliderGeometry` turns its axes in.
  _colliderRotation.setFromEuler(_colliderEuler.set(...rotation)).premultiply(frame.quaternion);
  return describeShape(shape, object)
    .setTranslation(_colliderPosition.x, _colliderPosition.y, _colliderPosition.z)
    .setRotation(_colliderRotation);
}

function describeShape(shape: BuiltShape, object: Object3D): RAPIER.ColliderDesc {
  return shape.kind === 'mesh' ? describeMesh(object, shape) : primitiveDesc(shape);
}

/** A shape with no mesh behind it, as Rapier builds it: a collider's, and a query's. */
function primitiveDesc(shape: Exclude<BuiltShape, { kind: 'mesh' }>): RAPIER.ColliderDesc {
  switch (shape.kind) {
    case 'box':
      return shape.rounding > 0
        ? RAPIER.ColliderDesc.roundCuboid(...shape.halfExtents, shape.rounding)
        : RAPIER.ColliderDesc.cuboid(...shape.halfExtents);
    case 'sphere':
      return RAPIER.ColliderDesc.ball(shape.radius);
    case 'capsule':
      return RAPIER.ColliderDesc.capsule(shape.halfHeight, shape.radius);
    case 'cylinder':
      return shape.rounding > 0
        ? RAPIER.ColliderDesc.roundCylinder(shape.halfHeight, shape.radius, shape.rounding)
        : RAPIER.ColliderDesc.cylinder(shape.halfHeight, shape.radius);
    case 'cone':
      return shape.rounding > 0
        ? RAPIER.ColliderDesc.roundCone(shape.halfHeight, shape.radius, shape.rounding)
        : RAPIER.ColliderDesc.cone(shape.halfHeight, shape.radius);
  }
}

/**
 * A query's shape, measured as a Collider is: through `colliderGeometry`, at
 * scale 1, so a box reads its full size and a capsule its height from end to
 * end, as the Collider pane shows them — and a capsule shorter than it is wide
 * is the sphere a collider would be. `null` for a mesh, which a query has none
 * of.
 */
function queryShape(shape: ColliderShape): RAPIER.Shape | null {
  const { shape: built } = colliderGeometry(shape, [1, 1, 1], undefined);
  return built.kind === 'mesh' ? null : primitiveDesc(built).shape;
}

/**
 * Where a joint on this object holds, in the world: its entity's pose as
 * physics reads it, composed with the joint's anchor and axis on it, the
 * pose's X along the axis.
 *
 * On the barrel for the editor's joint gizmo, drawn where this builds it, as
 * `worldPose` is for the collider outline.
 */
export function jointPose(object: Object3D, joint: JointComponent): JointPose {
  worldPose(object, _worldPosition, _worldQuaternion, _worldScale);
  const { anchor, axis } = jointFrame(joint, [_worldScale.x, _worldScale.y, _worldScale.z]);
  return {
    position: new Vector3(...anchor).applyQuaternion(_worldQuaternion).add(_worldPosition),
    quaternion: new Quaternion().setFromUnitVectors(UNIT_X, new Vector3(...axis)).premultiply(_worldQuaternion),
  };
}

const UNIT_X = new Vector3(1, 0, 0);

/**
 * An entity's world pose as physics reads it: its world matrix decomposed, the
 * rotation made unit length.
 *
 * Under a parent scaled unevenly, with the entity turned inside it, the world
 * matrix is sheared, and three hands back a rotation 0.933 long. Rapier
 * normalises nothing it is given, and stretched every offset that rotation
 * turned by its square: a box centred 2 m above such an entity held a ball at
 * 2.82 instead of 3. No shape can follow a shear; the collider is the one of
 * the decomposed pose, whose scale is the length of each axis of the world
 * matrix, Unity's lossy scale.
 *
 * On the barrel for the editor's collider outline, which must be drawn at the
 * pose the collider is built at: worked out a second way, the two parted under
 * exactly this shear.
 */
export function worldPose(
  object: Object3D,
  position: Vector3,
  quaternion: Quaternion,
  scale: Vector3,
): void {
  object.updateWorldMatrix(true, false);
  object.matrixWorld.decompose(position, quaternion, scale);
  quaternion.normalize();
}

/**
 * Places an object at a world transform while preserving its parenting.
 *
 * Physics reports world space, but the scene graph stores local transforms, so
 * writing the result straight onto `position` would double-apply any ancestor's
 * transform. Without a rotation the object is moved, and keeps its own.
 */
export function applyWorldTransform(
  object: Object3D,
  worldPosition: Vector3,
  worldQuaternion?: Quaternion,
): void {
  const parent = object.parent;
  if (!parent) {
    object.position.copy(worldPosition);
    if (worldQuaternion) object.quaternion.copy(worldQuaternion);
    return;
  }

  parent.updateWorldMatrix(true, false);
  _parentInverse.copy(parent.matrixWorld).invert();

  object.position.copy(worldPosition).applyMatrix4(_parentInverse);
  if (!worldQuaternion) return;
  // A scratch no caller can be holding. This read the parent's rotation into
  // `_worldQuaternion`, which `draw` passes in as `worldQuaternion`: the
  // body's rotation was overwritten before it was used, every body the solver
  // turned was drawn at the identity, and a rolling ball was drawn sliding.
  parent.getWorldQuaternion(_parentQuaternion);
  object.quaternion.copy(_parentQuaternion).invert().multiply(worldQuaternion);
}
