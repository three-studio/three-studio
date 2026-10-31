import {
  colliderGeometry,
  componentsOfType,
  entityWorldMatrixPath,
  findComponent,
  physicsBodies,
  type BodyType,
  type BuiltShape,
  type ColliderComponent,
  type CombineRule,
  type EntityDoc,
  type PhysicsSettings,
  type RigidBodyComponent,
  type SceneDoc,
} from '@three-studio/core';
import RAPIER from '@dimforge/rapier3d-compat';
import { Euler, Matrix4, Quaternion, Vector3, type Object3D } from 'three/webgpu';
import type { SceneBinder } from '../SceneBinder';
import { Character } from './Character';
import { describeMesh } from './meshShape';
import type {
  BodyHandle,
  CharacterController,
  CharacterSettings,
  PhysicsApi,
  QuatLike,
  Vec3Like,
} from './PhysicsApi';
import { isFiniteVec } from './values';

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
      if (this.moved()) this.teleport();
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
    if (this.moved()) this.teleport();

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
  private teleport(): void {
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
}

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

/** An entity whose colliders a body carries: its object, and its colliders. */
interface Carrier {
  readonly object: Object3D;
  readonly colliders: readonly ColliderComponent[];
}

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
  private readonly world: RAPIER.World;
  private readonly bodies = new Map<string, Body>();
  private accumulator = 0;

  private readonly fixedStep: number;
  private readonly maxSubsteps: number;

  private constructor(world: RAPIER.World, settings: PhysicsSettings) {
    this.fixedStep = settings.fixedTimestep;
    this.maxSubsteps = settings.maxSubsteps;
    const [x, y, z] = settings.gravity;
    this.gravity = Object.freeze({ x, y, z });
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
   */
  build(scene: SceneDoc, binder: SceneBinder): void {
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
        return carrier ? [{ object: carrier, colliders: Object.values(colliders[carrierId] ?? {}) }] : [];
      });
      this.addBody(entity, object, findComponent(scene, entityId, 'rigidbody'), carriers);
    }
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
   */
  step(delta: number, beforeStep?: (fixedDelta: number) => void): void {
    this.accumulator += Math.min(delta, this.fixedStep * this.maxSubsteps);

    let steps = 0;
    while (this.accumulator >= this.fixedStep && steps < this.maxSubsteps) {
      beforeStep?.(this.fixedStep);
      // After the behaviours, so a body follows where they put its entity this tick.
      for (const body of this.bodies.values()) body.beforeTick();
      this.world.step();
      for (const body of this.bodies.values()) body.afterTick();
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

  body(entityId: string): BodyHandle | null {
    return this.bodies.get(entityId) ?? null;
  }

  createCharacterController(
    entityId: string,
    settings: CharacterSettings,
  ): CharacterController | null {
    const body = this.bodies.get(entityId);
    if (!body?.collider) return null;
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

  dispose(): void {
    this.bodies.clear();
    this.world.free();
  }

  private addBody(
    entity: EntityDoc,
    object: Object3D,
    rigidbody: RigidBodyComponent | undefined,
    carriers: readonly Carrier[],
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

      for (const collider of carrier.colliders) {
        const shape = describeCollider(collider, carrier.object, _carrierScale, bodyType, _frame);
        const { material } = collider;
        shape.setFriction(material.friction);
        shape.setRestitution(material.restitution);
        shape.setFrictionCombineRule(COMBINE_RULES[material.frictionCombine]);
        shape.setRestitutionCombineRule(COMBINE_RULES[material.restitutionCombine]);
        shape.setSensor(collider.isSensor);
        const built = this.world.createCollider(shape, body);
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
    case 'mesh':
      return describeMesh(object, shape);
  }
}

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
 * transform.
 */
export function applyWorldTransform(
  object: Object3D,
  worldPosition: Vector3,
  worldQuaternion: Quaternion,
): void {
  const parent = object.parent;
  if (!parent) {
    object.position.copy(worldPosition);
    object.quaternion.copy(worldQuaternion);
    return;
  }

  parent.updateWorldMatrix(true, false);
  _parentInverse.copy(parent.matrixWorld).invert();

  object.position.copy(worldPosition).applyMatrix4(_parentInverse);
  // A scratch no caller can be holding. This read the parent's rotation into
  // `_worldQuaternion`, which `draw` passes in as `worldQuaternion`: the
  // body's rotation was overwritten before it was used, every body the solver
  // turned was drawn at the identity, and a rolling ball was drawn sliding.
  parent.getWorldQuaternion(_parentQuaternion);
  object.quaternion.copy(_parentQuaternion).invert().multiply(worldQuaternion);
}
