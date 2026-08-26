import {
  entitiesWith,
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

/** Physics runs at a fixed rate so behaviour does not depend on frame rate. */
/** Default step. The project can change it; see `PhysicsSettings`. */
export const FIXED_STEP = 1 / 60;
/** Cap on catch-up steps; beyond this the simulation slows rather than spirals. */
const DEFAULT_MAX_SUBSTEPS = 5;

export interface PhysicsBody {
  entityId: string;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider | null;
  /** Fixed bodies never move, so they are skipped when writing transforms back. */
  dynamic: boolean;
  /**
   * Positioned by a behaviour rather than by the solver.
   *
   * Such an entity already has its transform written by whatever drives it, and
   * copying the body back over that would undo the move — which is exactly what
   * left fly mode unable to move at all. Claimed by the behaviour itself, so a
   * vehicle chassis (which *is* solver-driven) simply does not claim it.
   */
  controllerDriven: boolean;
}

const _worldPosition = new Vector3();
const _worldQuaternion = new Quaternion();
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
 */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  private readonly bodies = new Map<string, PhysicsBody>();
  private accumulator = 0;

  private readonly fixedStep: number;
  private readonly maxSubsteps: number;

  private constructor(world: RAPIER.World, settings?: PhysicsSettings) {
    this.fixedStep = settings?.fixedTimestep ?? FIXED_STEP;
    this.maxSubsteps = settings?.maxSubsteps ?? DEFAULT_MAX_SUBSTEPS;
    this.world = world;
    this.world.timestep = this.fixedStep;
  }

  /**
   * Rapier is WebAssembly and must be initialised before any API is touched.
   * The `-compat` build inlines the module, so there is no extra file to serve.
   */
  static async create(settings?: PhysicsSettings): Promise<PhysicsWorld> {
    const gravity = settings?.gravity ?? [0, -9.81, 0];
    await RAPIER.init();
    return new PhysicsWorld(
      new RAPIER.World({ x: gravity[0], y: gravity[1], z: gravity[2] }),
      settings,
    );
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

    for (const entityId of physical) {
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
      this.world.step();
      this.accumulator -= this.fixedStep;
      steps += 1;
    }
  }

  /** Copies simulated transforms back onto the rendered objects. */
  writeBack(binder: SceneBinder): void {
    for (const entry of this.bodies.values()) {
      if (!entry.dynamic || entry.controllerDriven) continue;
      const object = binder.getObject(entry.entityId);
      if (!object) continue;

      const translation = entry.body.translation();
      const rotation = entry.body.rotation();
      _worldPosition.set(translation.x, translation.y, translation.z);
      _worldQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);

      applyWorldTransform(object, _worldPosition, _worldQuaternion);
    }
  }

  get(entityId: string): PhysicsBody | undefined {
    return this.bodies.get(entityId);
  }

  /** Declares that a behaviour writes this entity's transform, not the solver. */
  claimTransform(entityId: string): void {
    const entry = this.bodies.get(entityId);
    if (entry) entry.controllerDriven = true;
  }

  createCharacterController(offset = 0.02): RAPIER.KinematicCharacterController {
    const controller = this.world.createCharacterController(offset);
    // Without autostep a character catches on every kerb and stair edge.
    controller.enableAutostep(0.4, 0.2, true);
    // Without snap-to-ground, walking down a slope becomes a series of hops.
    controller.enableSnapToGround(0.4);
    controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    controller.setApplyImpulsesToDynamicBodies(true);
    return controller;
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

    this.bodies.set(entity.id, {
      entityId: entity.id,
      body,
      collider: created,
      dynamic: bodyType !== 'fixed',
      controllerDriven: false,
    });
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
  parent.getWorldQuaternion(_worldQuaternion);
  object.quaternion.copy(_worldQuaternion).invert().multiply(worldQuaternion);
}
