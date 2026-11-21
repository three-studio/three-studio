import type { EntityDoc, EntityId, SceneDoc } from '@three-studio/core';
import { Quaternion, Vector3, type Euler, type Object3D } from 'three/webgpu';
import type { QuatLike, Vec3Like } from '../vectors';

/** What a script reaches its world through, as `this.world`. */
export interface ScriptWorld {
  /**
   * The handle of an entity this world holds, or `null`: one destroyed, one
   * never there, or text that is no id — a script's values are not typechecked
   * where they come from.
   */
  entity(id: string): Entity | null;
}

/*
 * Where a world read lands before it is copied into the caller's target, which
 * may be a plain object three cannot write into. Value objects, one each, read
 * and written within one call.
 */
const WORLD_POSITION = new Vector3();
const WORLD_DIRECTION = new Vector3();
const WORLD_QUATERNION = new Quaternion();

/**
 * Where an entity is, as its script moves it: the drawing's own vectors, which
 * the world draws and physics compares with what it last wrote, so a write
 * here is seen the frame it is made — a dynamic body is put there, a kinematic
 * one follows. The document is never written: what moves is hot state, and
 * stays in the drawing.
 */
export class EntityTransform {
  /** Local to its parent, in metres: the vector itself, read and written in place. */
  readonly position: Vector3;
  /** Euler angles in radians, local, kept in step with `quaternion` by three. */
  readonly rotation: Euler;
  readonly quaternion: Quaternion;
  readonly scale: Vector3;

  constructor(private readonly object: Object3D) {
    // three defines these once per object and never replaces them, so a field
    // is the vector itself, without a getter's call each time a script reads it.
    this.position = object.position;
    this.rotation = object.rotation;
    this.quaternion = object.quaternion;
    this.scale = object.scale;
  }

  /** Where it is in the world, written into `target`, which comes back. */
  getWorldPosition<T extends Vec3Like>(target: T): T {
    this.object.getWorldPosition(WORLD_POSITION);
    target.x = WORLD_POSITION.x;
    target.y = WORLD_POSITION.y;
    target.z = WORLD_POSITION.z;
    return target;
  }

  /** How it is turned in the world, written into `target`, which comes back. */
  getWorldQuaternion<T extends QuatLike>(target: T): T {
    this.object.getWorldQuaternion(WORLD_QUATERNION);
    target.x = WORLD_QUATERNION.x;
    target.y = WORLD_QUATERNION.y;
    target.z = WORLD_QUATERNION.z;
    target.w = WORLD_QUATERNION.w;
    return target;
  }

  /** The way its local +Z points in the world, unit length, written into `target`, which comes back. */
  getWorldDirection<T extends Vec3Like>(target: T): T {
    this.object.getWorldDirection(WORLD_DIRECTION);
    target.x = WORLD_DIRECTION.x;
    target.y = WORLD_DIRECTION.y;
    target.z = WORLD_DIRECTION.z;
    return target;
  }

  /** Turns it so its local +Z faces a point in the world. */
  lookAt(point: Readonly<Vec3Like>): void {
    this.object.lookAt(point.x, point.y, point.z);
  }
}

/**
 * An entity of a running world, as a script holds it: one per entity per
 * world, made the first time it is asked for and kept by its container, so it
 * lives exactly as long as the drawing does and nothing has to be told when the
 * entity goes.
 *
 * It reads the world's document, never a copy: destroyed, it says so from that
 * moment, while its objects stay until the frame's pass takes them down.
 */
export class Entity {
  readonly transform: EntityTransform;

  constructor(
    readonly id: EntityId,
    /** Its record in the running world's document, which keeps its identity: core's graph writes records in place. */
    private readonly record: EntityDoc,
    /**
     * Its container: what the world draws it as. Outside the stability
     * contract — the escape hatch to three for what the façade does not say.
     */
    readonly object3D: Object3D,
    private readonly document: SceneDoc,
    private readonly world: ScriptWorld,
  ) {
    this.transform = new EntityTransform(object3D);
  }

  /** Its record's, which a destroyed entity's last hooks can still log. */
  get name(): string {
    return this.record.name;
  }

  /**
   * Whether the world's document holds it: false from the moment it is
   * destroyed. Its record, not its id, which a later spawn may take again.
   */
  get alive(): boolean {
    return this.document.entities.get(this.id) === this.record;
  }

  /** The handle of the entity it hangs under, or `null` at the top, and once it is destroyed. */
  get parent(): Entity | null {
    const parent = this.alive ? this.record.parent : null;
    return parent === null ? null : this.world.entity(parent);
  }
}
