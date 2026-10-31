import {
  entitiesWith,
  entityWorldMatrixPath,
  findComponent,
  type ColliderComponent,
  type EntityDoc,
  type PhysicsSettings,
  type RigidBodyComponent,
  type SceneDoc,
} from '@three-studio/core';
import RAPIER from '@dimforge/rapier3d-compat';
import { Box3, Matrix4, Mesh, Quaternion, Vector3, type Object3D } from 'three/webgpu';
import type { SceneBinder } from '../SceneBinder';
import { Character } from './Character';
import type {
  BodyHandle,
  CharacterController,
  CharacterSettings,
  PhysicsApi,
  QuatLike,
  Vec3Like,
} from './PhysicsApi';

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
 * A body as the world keeps it: Rapier's, the collider built on it, its
 * entity's object and its driver.
 */
class Body implements BodyHandle {
  /**
   * The object's local pose as the world last left it. Anything else there is
   * someone else's write.
   */
  private readonly written = { position: new Vector3(), quaternion: new Quaternion() };

  constructor(
    readonly rapier: RAPIER.RigidBody,
    /** The one a character sweeps; `null` when the entity has no collider. */
    readonly collider: RAPIER.Collider | null,
    /**
     * The entity's container, kept from the build. The binder creates it once,
     * and nothing syncs the binder while a game runs, so it is the entity's
     * object for the engine's life.
     */
    readonly object: Object3D,
    public driver: Driver,
  ) {
    this.remember();
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
      return;
    }
    this.object.updateWorldMatrix(true, false);
    this.object.matrixWorld.decompose(_worldPosition, _worldQuaternion, _worldScale);
    this.rapier.setNextKinematicTranslation(_worldPosition);
    this.rapier.setNextKinematicRotation(_worldQuaternion);
  }

  /**
   * After the frame's ticks: the pose of a body the solver or a character
   * moves, onto its object.
   *
   * Not a kinematic body's: it follows its entity, which is where its script
   * put it. Drawn at its body, the body nothing had moved was written over the
   * script's move every frame, and a moving platform never left its place. Nor
   * a disabled body's, since whoever disabled it places its entity.
   */
  draw(): void {
    if ((this.driver !== 'solver' && this.driver !== 'controller') || !this.enabled) return;
    // A frame with no tick still takes a write made in `onUpdate` or `onLateUpdate`.
    if (this.moved()) this.teleport();

    const translation = this.rapier.translation();
    const rotation = this.rapier.rotation();
    _worldPosition.set(translation.x, translation.y, translation.z);
    _worldQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    applyWorldTransform(this.object, _worldPosition, _worldQuaternion);
    this.remember();
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
    this.object.updateWorldMatrix(true, false);
    this.object.matrixWorld.decompose(_worldPosition, _worldQuaternion, _worldScale);
    this.rapier.setTranslation(_worldPosition, true);
    this.rapier.setRotation(_worldQuaternion, true);
    this.remember();
  }

  private remember(): void {
    this.written.position.copy(this.object.position);
    this.written.quaternion.copy(this.object.quaternion);
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
}

const _worldPosition = new Vector3();
const _worldQuaternion = new Quaternion();
const _parentQuaternion = new Quaternion();
const _worldScale = new Vector3();
const _parentInverse = new Matrix4();
const _localMatrix = new Matrix4();
const _bounds = new Box3();

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
   * Creates a body for every entity that declares physics.
   *
   * Driven by the two component tables rather than by a walk of the entity
   * table: a scene of two thousand props with a dozen physical objects in it
   * visits the dozen.
   */
  build(scene: SceneDoc, binder: SceneBinder): void {
    const physical = new Set([
      ...entitiesWith(scene, 'rigidbody'),
      ...entitiesWith(scene, 'collider'),
    ]);

    // Parents first, because `writeBack` writes the bodies in the order they
    // were added. A child written before its parent was placed against the pose
    // its parent was about to leave, and drawn a frame of its parent's motion
    // off its own body. `sort` is stable, so siblings keep their table order.
    const parentsFirst = [...physical]
      .map((entityId) => ({ entityId, depth: entityWorldMatrixPath(scene, entityId).length }))
      .sort((a, b) => a.depth - b.depth);

    for (const { entityId } of parentsFirst) {
      const entity = scene.entities[entityId];
      if (!entity) continue;

      const object = binder.getObject(entityId);
      if (!object) continue;

      this.addBody(
        entity,
        object,
        findComponent(scene, entityId, 'rigidbody'),
        findComponent(scene, entityId, 'collider'),
      );
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
      this.accumulator -= this.fixedStep;
      steps += 1;
    }
  }

  /**
   * Draws the bodies onto their entities once the frame's ticks have run, in
   * the order they were built: parents first.
   */
  writeBack(): void {
    for (const body of this.bodies.values()) body.draw();
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
    collider: ColliderComponent | undefined,
  ): void {
    object.updateWorldMatrix(true, false);
    object.matrixWorld.decompose(_worldPosition, _worldQuaternion, _worldScale);

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
    }

    const body = this.world.createRigidBody(desc);

    let created: RAPIER.Collider | null = null;
    if (collider) {
      const shape = describeCollider(collider, object, _worldScale);
      if (shape) {
        shape.setFriction(collider.friction);
        shape.setRestitution(collider.restitution);
        shape.setSensor(collider.isSensor);
        if (rigidbody) shape.setMass(rigidbody.mass);
        created = this.world.createCollider(shape, body);
      }
    }

    this.bodies.set(entity.id, new Body(body, created, object, DRIVER_OF[bodyType]));
  }
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
 * Collider shapes are scaled by the entity's world scale, because Rapier has no
 * notion of a scaled shape — a box scaled 2× in the scene must be described as
 * a box with doubled half-extents.
 */
function describeCollider(
  collider: ColliderComponent,
  object: Object3D,
  scale: Vector3,
): RAPIER.ColliderDesc | null {
  const uniform = Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));

  switch (collider.shape) {
    case 'box':
      return RAPIER.ColliderDesc.cuboid(
        collider.size[0] * Math.abs(scale.x),
        collider.size[1] * Math.abs(scale.y),
        collider.size[2] * Math.abs(scale.z),
      );
    case 'sphere':
      return RAPIER.ColliderDesc.ball(collider.radius * uniform);
    case 'capsule':
      return RAPIER.ColliderDesc.capsule(collider.halfHeight * uniform, collider.radius * uniform);
    case 'trimesh':
    case 'convexHull': {
      const vertices = collectVertices(object, scale);
      if (!vertices) return fallbackBox(object, scale);
      return collider.shape === 'trimesh'
        ? RAPIER.ColliderDesc.trimesh(
            vertices.positions,
            vertices.indices,
            // Without this, a character catches on the shared edge between two
            // coplanar triangles — which is every seam in every imported piece
            // of level geometry. It cost half the strafing speed on a floor
            // made of two triangles, and only in the directions that crossed
            // the diagonal.
            RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES,
          )
        : (RAPIER.ColliderDesc.convexHull(vertices.positions) ?? fallbackBox(object, scale));
    }
  }
}

/** A mesh-derived shape is impossible without geometry; a box is better than nothing. */
function fallbackBox(object: Object3D, scale: Vector3): RAPIER.ColliderDesc {
  _bounds.setFromObject(object, true);
  const size = _bounds.getSize(new Vector3());
  return RAPIER.ColliderDesc.cuboid(
    Math.max(size.x / 2, 0.01) * Math.abs(scale.x),
    Math.max(size.y / 2, 0.01) * Math.abs(scale.y),
    Math.max(size.z / 2, 0.01) * Math.abs(scale.z),
  );
}

/** Flattens an entity's meshes into one vertex soup, in the entity's local space. */
function collectVertices(
  object: Object3D,
  scale: Vector3,
): { positions: Float32Array; indices: Uint32Array } | null {
  const positions: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;
  let found = false;

  object.updateWorldMatrix(true, true);
  _parentInverse.copy(object.matrixWorld).invert();

  object.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const attribute = child.geometry.getAttribute('position');
    if (!attribute) return;
    found = true;

    _localMatrix.multiplyMatrices(_parentInverse, child.matrixWorld);
    const vertex = new Vector3();

    for (let i = 0; i < attribute.count; i++) {
      vertex.fromBufferAttribute(attribute, i).applyMatrix4(_localMatrix);
      positions.push(vertex.x * scale.x, vertex.y * scale.y, vertex.z * scale.z);
    }

    const index = child.geometry.getIndex();
    if (index) {
      for (let i = 0; i < index.count; i++) indices.push(index.getX(i) + vertexOffset);
    } else {
      for (let i = 0; i < attribute.count; i++) indices.push(i + vertexOffset);
    }
    vertexOffset += attribute.count;
  });

  if (!found) return null;
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
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
  // `_worldQuaternion`, which `writeBack` passes in as `worldQuaternion`: the
  // body's rotation was overwritten before it was used, every body the solver
  // turned was drawn at the identity, and a rolling ball was drawn sliding.
  parent.getWorldQuaternion(_parentQuaternion);
  object.quaternion.copy(_parentQuaternion).invert().multiply(worldQuaternion);
}
