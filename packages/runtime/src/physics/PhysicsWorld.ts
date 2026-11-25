import {
  bodyOf,
  collectDescendants,
  colliderGeometry,
  conformPhysicsMaterial,
  createColliderShape,
  entityWorldMatrixPath,
  findComponent,
  findComponents,
  hasComponent,
  isEntityId,
  jointEnds,
  linkedPhysicsMaterial,
  type BodyType,
  type AssetId,
  type BuiltShape,
  type ColliderComponent,
  type ColliderShape,
  type CombineRule,
  type ComponentDoc,
  type EntityId,
  type JointComponent,
  type PhysicsMaterialDef,
  type PhysicsSettings,
  type RigidBodyComponent,
  type SceneDoc,
} from '@three-studio/core';
import RAPIER from '@dimforge/rapier3d-compat';
import { Euler, Matrix4, Quaternion, Vector3, type Mesh, type Object3D } from 'three/webgpu';
import type { SceneBinder } from '../SceneBinder';
import { Character } from './Character';
import { Joint, holdingPose, type JointBodies, type JointPose, type Placed } from './joints';
import { collisionGroups, layerBits } from './layers';
import { describeMesh, ownMeshes } from './meshShape';
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
 * A body as the world keeps it: Rapier's, its entity's object, its driver,
 * what it was made from, and the colliders riding it.
 */
class Body implements BodyHandle {
  /**
   * The object's local pose as the world last left it. Anything else there is
   * someone else's write.
   */
  private readonly written = { position: new Vector3(), quaternion: new Quaternion() };
  /**
   * The body's world pose when the last tick began, where drawing between ticks
   * starts; where it sleeps, while it rests.
   */
  private readonly previous = { position: new Vector3(), quaternion: new Quaternion() };
  /** A force or a torque was added since the last tick, for `afterTick` to drop. */
  private pushed = false;
  /**
   * Asleep, and drawn where it sleeps: nothing of it is read from Rapier until
   * it wakes. Each read of a pose makes a typed array in Rapier's bindings,
   * whatever it is read into, and a body read its pose four times a frame:
   * 180 KB a frame for a thousand boxes at rest.
   */
  private resting = false;
  /**
   * Its world pose when it was made: what a joint's frames on it are measured
   * from, when the joint is built and each time it is built again.
   */
  readonly built: { readonly position: Vector3; readonly quaternion: Quaternion };
  /**
   * The colliders riding it, as the table of owners holds them: they join and
   * leave it as their carriers' components come and go, the body keeping its
   * handle, its pose and its velocities.
   */
  readonly colliders: Built[] = [];

  constructor(
    readonly rapier: RAPIER.RigidBody,
    /** The entity it sits on, whose Rigid Body it is, or whose colliders are level geometry. */
    readonly entityId: EntityId,
    /**
     * The entity's container. The binder makes it once and keeps it while the
     * entity is in the document, which the body is not without.
     */
    readonly object: Object3D,
    public driver: Driver,
    /**
     * Its Rigid Body as last applied, when made and by each patch since; `null`
     * on level geometry, a collider with no Rigid Body above it.
     */
    public rigidbody: RigidBodyComponent | null,
    /** How deep its entity is, 1 at the root: bodies are drawn shallowest first. */
    readonly depth: number,
  ) {
    this.built = {
      position: new Vector3().copy(rapier.translation()),
      quaternion: new Quaternion().copy(rapier.rotation()),
    };
    this.rememberWritten();
    this.rememberPrevious();
  }

  /**
   * The one a character sweeps: the first collider of the body's own entity,
   * which `findComponent` returns and `PlayerController` measures its feet
   * from. `null` when the entity's colliders are all on its children, or it
   * has none.
   */
  get collider(): RAPIER.Collider | null {
    for (const built of this.colliders) if (built.owner.entity === this.entityId) return built.collider;
    return null;
  }

  /**
   * Its Rigid Body's values at once, from the desc the world would build it
   * with: its type, its dampings, its gravity scale, its continuous detection
   * and the axes it leaves free.
   *
   * The type sets its driver as the build does, but a character's stays its
   * controller's, and kinematic: its controller drives it, whatever its type
   * says. A new driver starts as if just built there: drawn between ticks from
   * where the body is, and its object's pose taken as the world's own write,
   * so the change reads as no script's.
   */
  tune(rigidbody: RigidBodyComponent, desc: RAPIER.RigidBodyDesc): void {
    const driver = this.driver === 'controller' ? 'controller' : DRIVER_OF[rigidbody.bodyType];
    const wasSmooth = this.smooth;
    if (driver !== 'controller' && this.rapier.bodyType() !== desc.status) this.rapier.setBodyType(desc.status, true);
    this.rapier.setLinearDamping(desc.linearDamping);
    this.rapier.setAngularDamping(desc.angularDamping);
    this.rapier.setGravityScale(desc.gravityScale, true);
    this.rapier.enableCcd(desc.ccdEnabled);
    this.rapier.setEnabledTranslations(
      desc.translationsEnabledX,
      desc.translationsEnabledY,
      desc.translationsEnabledZ,
      true,
    );
    this.rapier.setEnabledRotations(desc.rotationsEnabledX, desc.rotationsEnabledY, desc.rotationsEnabledZ, true);
    // Held still along what it locks, as a body built locked is. Rapier only
    // stops the solver changing a locked axis's speed: a ball locked in its
    // fall went on falling at the speed it had, 4.9 m in the next second.
    if (this.rapier.isDynamic()) {
      const v = this.rapier.linvel();
      const w = this.rapier.angvel();
      this.rapier.setLinvel(
        {
          x: desc.translationsEnabledX ? v.x : 0,
          y: desc.translationsEnabledY ? v.y : 0,
          z: desc.translationsEnabledZ ? v.z : 0,
        },
        true,
      );
      this.rapier.setAngvel(
        { x: desc.rotationsEnabledX ? w.x : 0, y: desc.rotationsEnabledY ? w.y : 0, z: desc.rotationsEnabledZ ? w.z : 0 },
        true,
      );
    }

    if (driver === this.driver) {
      this.rigidbody = rigidbody;
      // Not sweeping in from where it was last drawn at its tick.
      if (this.smooth && !wasSmooth) this.rememberPrevious();
      return;
    }
    // Drawn once where it is, as the world stops drawing it. Its object was up
    // to a tick behind it, and a kinematic body following its object would be
    // pulled back that far, flinging what rests on it.
    if (this.driver === 'solver') this.draw(1);
    this.driver = driver;
    this.rigidbody = rigidbody;
    this.rememberPrevious();
    this.rememberWritten();
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
      // A resting body's `previous` is where it sleeps already.
      if (this.smooth && !this.resting) this.rememberPrevious();
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
    // A character's body is read whatever Rapier says of its sleep: its
    // controller moves it.
    const asleep = this.driver === 'solver' && this.rapier.isSleeping();
    if (asleep && this.resting) {
      // At the root its object is where the world left it; under another
      // entity it is placed again, that entity having perhaps moved.
      if (this.depth > 1) {
        applyWorldTransform(this.object, this.previous.position, this.previous.quaternion);
        this.rememberWritten();
      }
      return;
    }

    // Into the scratches, where Rapier made a new object of each, every frame.
    this.rapier.translation(_worldPosition);
    this.rapier.rotation(_worldQuaternion);
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
    // Fallen asleep: from the next frame on, drawn where it sleeps.
    this.resting = asleep;
    if (asleep) {
      this.previous.position.copy(_worldPosition);
      this.previous.quaternion.copy(_worldQuaternion);
    }
  }

  /**
   * Drawn between its last two ticks. The player's camera rides a character's
   * body, which always is.
   */
  private get smooth(): boolean {
    return this.driver === 'controller' || (this.rigidbody?.interpolate ?? false);
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
    this.rapier.translation(this.previous.position);
    this.rapier.rotation(this.previous.quaternion);
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
const _colliderEuler = new Euler();
const _colliderRotation = new Quaternion();
const _colliderPosition = new Vector3();

/** A pose on a body, in its frame. */
interface Frame {
  readonly position: Vector3;
  readonly quaternion: Quaternion;
}

/** A primitive's: no meshes behind it. */
const NO_MESHES: readonly Mesh[] = [];

/** The entity a collider was built from, and the entity whose body it rides: the same one on its own body. */
export interface ColliderOwner {
  readonly entity: EntityId;
  readonly body: EntityId;
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

/**
 * A collider the world built: whom an event names for it, and what it was
 * built from, which a patch builds it from again.
 */
interface Built {
  readonly owner: ColliderOwner;
  /** Its Collider as last applied, when built and by each patch since. */
  component: ColliderComponent;
  /** Its entity's object, whose own meshes a mesh collider is built from. */
  readonly carrier: Object3D;
  /**
   * The meshes its shape was built from, a mesh collider's: its entity's own
   * then, which a model landing since replaces.
   */
  meshes: readonly Mesh[];
  /** Its entity's world scale, fixed when it was built, as the place below is. */
  readonly scale: Vector3;
  /** Its entity's place on the body. */
  readonly frame: Frame;
  readonly collider: RAPIER.Collider;
}

/** What a physics world is built from, and reads as it mounts what it is handed. */
export interface PhysicsSource {
  /** The document its components are in: a running world's own, read as they are mounted. */
  readonly scene: SceneDoc;
  /** The entities' objects, whose world poses its bodies are made at. */
  readonly objects: Pick<SceneBinder, 'getObject'>;
  /** The project's physics materials by asset id, which a collider linking one is built with. */
  readonly materials?: ReadonlyMap<AssetId, PhysicsMaterialDef>;
  /** The values an asset is played with in place of its file's, when given some (`World.setAssetValues`). */
  readonly assetValues?: (assetId: AssetId) => object | undefined;
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
 * Two faces. The lifecycle — `create`; `mount`, `patch` and `unmount` for each
 * Rigid Body, Collider and Joint as its world's document holds them, `settle`
 * once a pass has handed them; `start`, `tick`, `writeBack`, `dispose` — is the
 * physics subsystem's alone. `PhysicsApi` is what behaviours are handed, and
 * nothing of Rapier's crosses it.
 */
export class PhysicsWorld implements PhysicsApi {
  readonly gravity: Readonly<Vec3Like>;
  readonly layers: readonly Readonly<{ id: string; name: string }>[];
  private readonly world: RAPIER.World;
  private readonly bodies = new Map<EntityId, Body>();
  /**
   * The bodies in the order they are drawn, parents first: `writeBack` writes
   * them in this order, and a child written before its parent was placed
   * against the pose its parent was about to leave, and drawn a frame of its
   * parent's motion off its own body. By depth, a body made later filed after
   * those as deep as it is.
   */
  private readonly order: Body[] = [];
  /** Each carrier's colliders, by the entity they were built from, in its table's order. */
  private readonly carried = new Map<EntityId, Built[]>();
  /**
   * Colliders taken out since the last tick, kept in `owners` until its events
   * are read: Rapier reports a removed collider's pairs as stopped at the next
   * step, and the other side hears it leave, as Godot's `body_exited` is heard
   * for a freed body.
   */
  private readonly leaving: number[] = [];
  /** The entities a pass gave or took a Rigid Body or a Collider, for `settle` to bring their bodies in line. */
  private readonly touched = new Set<EntityId>();
  /** Joints a pass mounted, built at its `settle`, once their bodies are. */
  private arrivedJoints: { readonly entityId: EntityId; readonly component: JointComponent }[] = [];
  /** A body was made or taken away since the joints last found their ends. */
  private bodiesMoved = false;
  /** Drained before each step, so the events of a world nobody listens to cannot pile up. */
  private readonly events = new RAPIER.EventQueue(true);
  /**
   * Each collider's entity and body, by Rapier's handle: an event names two
   * handles, and no handle leaves this module. Whatever builds a collider
   * registers it here, or nothing it touches is ever heard.
   */
  private readonly owners = new Map<number, Built>();
  /**
   * The pairs a sensor overlaps, by their two handles: heard leaving as they
   * were heard entering. A collider tuned to a sensor or back ends its pairs
   * under its new kind, and a contact's end then read as a trigger's.
   */
  private readonly triggers = new Set<string>();
  /** The project's physics materials by asset id. */
  private readonly materials: ReadonlyMap<AssetId, PhysicsMaterialDef>;
  /** The values an asset is played with in place of its file's, read as a collider linking it is built. */
  private readonly assetValues: (assetId: AssetId) => object | undefined;
  /** What touched when the world was built, for the first tick to hand out before its own. */
  private readonly atBuild: PhysicsEvent[] = [];
  /**
   * What the last tick heard, handed out until the next: one array for the
   * world's life, so a tick that hears nothing makes nothing.
   */
  private readonly heard: PhysicsEvent[] = [];
  /** Rapier's queue, read whole into this before any pair is asked where it touches. */
  private readonly drained: { readonly first: number; readonly second: number; readonly started: boolean }[] = [];
  /** Rapier's callback for each event in its queue, made once rather than per tick. */
  private readonly onCollisionEvent = (first: number, second: number, started: boolean): void => {
    this.drained.push({ first, second, started });
  };
  /** What a joint with no Connected Body is held to; made by the first one. */
  private grounding: Placed | null = null;
  /**
   * Each entity's Joints, holding or not, in table order: the Inspector adds
   * one, a hand-edited file may hold two.
   */
  private readonly joints = new Map<EntityId, Joint[]>();
  /** The document mounted from, whose tree says which body a collider rides and which bodies a joint holds. */
  private readonly scene: SceneDoc;
  private readonly objects: Pick<SceneBinder, 'getObject'>;
  /** Moves with each tick and each patch: the debug view read at a version holds until it moves. */
  private version = 0;
  private debug: { readonly version: number; readonly lines: DebugLines } | null = null;

  private readonly fixedStep: number;
  /** Each layer's collision groups, by its id: project data, as gravity and the step are. */
  private readonly groupsOf: (layerId: string) => number;
  /** The bits of the layers a query asks for, by their ids. */
  private readonly bitsOf: (layerIds: readonly string[]) => number;

  private constructor(world: RAPIER.World, settings: PhysicsSettings, source: PhysicsSource) {
    this.fixedStep = settings.fixedTimestep;
    this.groupsOf = collisionGroups(settings.layers);
    this.bitsOf = layerBits(settings.layers);
    const [x, y, z] = settings.gravity;
    this.gravity = Object.freeze({ x, y, z });
    // Without what each ignores, which is the matrix's business.
    this.layers = Object.freeze(settings.layers.map(({ id, name }) => Object.freeze({ id, name })));
    this.world = world;
    this.world.timestep = this.fixedStep;
    this.scene = source.scene;
    this.objects = source.objects;
    this.materials = source.materials ?? new Map();
    this.assetValues = source.assetValues ?? (() => undefined);
  }

  /**
   * Rapier is WebAssembly and must be initialised before any API is touched.
   * The `-compat` build inlines the module, so there is no extra file to serve.
   *
   * The settings are required, and the world has no defaults of its own: they
   * were a second copy of `createPhysicsSettings()`, and the copy the editor's
   * Step read, so it advanced 1/60 whatever step the project had chosen.
   */
  static async create(settings: PhysicsSettings, source: PhysicsSource): Promise<PhysicsWorld> {
    await RAPIER.init();
    const [x, y, z] = settings.gravity;
    return new PhysicsWorld(new RAPIER.World({ x, y, z }), settings, source);
  }

  /**
   * A Rigid Body, a Collider or a Joint arrived on an entity. What it changes
   * is built when the pass settles: by then every component of the pass is in
   * the document and every entity's object is placed, so a body is made where
   * its entity stands and carries what rides it.
   */
  mount(entityId: EntityId, component: ComponentDoc): void {
    if (component.type === 'joint') this.arrivedJoints.push({ entityId, component });
    else if (component.type === 'rigidbody' || component.type === 'collider') this.touched.add(entityId);
  }

  /**
   * One changed in place, and taken at once as if built with its new values:
   * through the functions that built it — `describeBody`, `describeCollider`,
   * a Joint's own —, its handles, contacts and velocities kept, so that no
   * second way from the document to Rapier can fall out of step with the
   * first. A tune in Play is one of these.
   *
   * Handed back as it is (`previous === next`) — a model landed on its entity,
   * a physics material it links plays other values, an entity it names
   * changed —, it is read again the same way: a mesh Collider builds its shape
   * again when its entity's meshes are not those it was built from.
   */
  patch(entityId: EntityId, _previous: ComponentDoc, next: ComponentDoc): void {
    switch (next.type) {
      case 'rigidbody':
        this.tuneBody(entityId, next);
        break;
      case 'collider': {
        const built = this.carried.get(entityId)?.find((each) => each.component.id === next.id);
        const body = built && this.bodies.get(built.owner.body);
        if (!built || !body) return;
        this.tuneCollider(built, next, body, false);
        this.weighAgain(body);
        break;
      }
      case 'joint':
        this.joints
          .get(entityId)
          ?.find((joint) => joint.component.id === next.id)
          ?.remake(next, this.endsOf(entityId, next));
        break;
      default:
        return;
    }
    // Shown at once, paused or not.
    this.version += 1;
  }

  /** One left: what it made goes when the pass settles; a Joint at once, holding nothing. */
  unmount(entityId: EntityId, component: ComponentDoc): void {
    if (component.type === 'rigidbody' || component.type === 'collider') {
      this.touched.add(entityId);
      return;
    }
    if (component.type !== 'joint') return;
    const held = this.joints.get(entityId);
    const at = held?.findIndex((joint) => joint.component.id === component.id) ?? -1;
    if (held === undefined || at < 0) return;
    held[at]?.remake(component, null);
    held.splice(at, 1);
    if (held.length === 0) this.joints.delete(entityId);
    this.version += 1;
  }

  /**
   * The bodies brought in line with what the pass touched, by the rule of
   * `bodyOf`: a collider rides the nearest Rigid Body up its tree, its own
   * included, and with none above it is level geometry, a fixed body of its
   * own entity.
   *
   * A carrier whose body changed, or whose colliders did, gives what left back
   * and builds what came on the body it rides now, its place on that body read
   * from where both stand now. A body is made when an entity first needs one,
   * at its object's world pose, and goes when it holds neither a Rigid Body nor
   * a collider; one whose Rigid Body came or went is of another kind, made
   * again with everything riding it and every carrier under its entity. A body
   * keeps its handle, its pose and its velocities while colliders join or leave
   * it: a falling player picking up something with a collider keeps its fall.
   *
   * Each body whose colliders changed is weighed again and woken; the joints a
   * pass mounted are built, and every joint finds its ends again if a body came
   * or went.
   */
  settle(): void {
    if (this.touched.size === 0 && this.arrivedJoints.length === 0) return;
    const carriers = new Set<EntityId>();
    const reweigh = new Set<Body>();

    for (const entityId of this.touched) {
      carriers.add(entityId);
      const body = this.bodies.get(entityId);
      const rigidbody = this.scene.entities.has(entityId)
        ? findComponent(this.scene, entityId, 'rigidbody')
        : undefined;
      // The same Rigid Body, or none still: a patch took its values. Another
      // one makes a body of its own.
      if (rigidbody?.id === body?.rigidbody?.id) continue;
      // Down to the next body, and past it: a carrier riding another is built
      // again where it was, and the walk stays within the subtree.
      for (const below of collectDescendants(this.scene, entityId)) {
        if (this.carried.has(below) || hasComponent(this.scene, below, 'collider')) carriers.add(below);
      }
      if (body) this.takeDown(body, carriers);
    }

    for (const carrierId of carriers) this.carry(carrierId, reweigh);

    // A Rigid Body with no collider anywhere still makes its body, weighed by
    // its mass alone.
    for (const entityId of this.touched) {
      if (!this.scene.entities.has(entityId) || !hasComponent(this.scene, entityId, 'rigidbody')) continue;
      const body = this.bodyFor(entityId);
      if (body) reweigh.add(body);
    }

    for (const body of reweigh) {
      if (this.needed(body)) this.weighAgain(body);
      else this.removeBody(body);
    }

    for (const { entityId, component } of this.arrivedJoints) this.makeJoint(entityId, component);
    this.arrivedJoints = [];
    if (this.bodiesMoved) {
      this.bodiesMoved = false;
      for (const [entityId, held] of this.joints) {
        for (const joint of held) joint.reEnd(this.endsOf(entityId, joint.component));
      }
    }
    this.touched.clear();
    this.version += 1;
  }

  /**
   * Once the scene is built: a step of no time, so that a query sees the scene
   * from the start. Rapier files colliders for its queries as it steps, and a
   * world not yet stepped answered none: a script placing itself on the ground
   * in `onStart`, or asking at its first tick, met nothing. It moves nothing —
   * a ball resting on the ground kept its place and no speed, two boxes built
   * into each other stayed where they were — and reports as started what
   * touches already, which no tick reports again: the first tick hands that
   * out, after every `onStart`, when it was heard before. A body made later is
   * seen by queries from the next tick.
   *
   * A nanosecond rather than none: after a step of exactly no time, Rapier 0.21
   * panics (`unreachable`) at the next step once a body has been disabled — a
   * player built flying, or a script's `enabled = false` in `onStart` —, which
   * brought the whole world down. Gravity moves a body 5e-18 m in it.
   */
  start(): void {
    this.world.timestep = 1e-9;
    this.step();
    this.world.timestep = this.fixedStep;
    this.drainInto(this.atBuild);
    this.forgetLeaving();
  }

  /**
   * Advances the simulation by one fixed step: the world's, whose clock
   * decides how many a frame runs — a variable step would make a stack of
   * boxes settle differently on a 60 Hz and a 144 Hz display, and jump heights
   * frame-rate dependent.
   *
   * Run after whatever commands a kinematic body in the tick: `setNextKinematic*`
   * is a target, not an impulse, so a command given at display rate would
   * overwrite itself between ticks and lose most of the motion.
   *
   * Returns what started or stopped touching in it — the first tick also what
   * touched when the world was built —, once the tick's forces are dropped: a
   * force added by whoever hears it is felt in the next tick, and a kick at
   * once. The array is the world's, and holds the next tick's once it has run.
   */
  tick(): readonly PhysicsEvent[] {
    // After the behaviours, so a body follows where they put its entity this tick.
    for (let i = 0; i < this.order.length; i += 1) this.order[i]?.beforeTick();
    this.step();
    this.version += 1;
    for (let i = 0; i < this.order.length; i += 1) this.order[i]?.afterTick();
    this.heard.length = 0;
    for (let i = 0; i < this.atBuild.length; i += 1) {
      const event = this.atBuild[i];
      if (event !== undefined) this.heard.push(event);
    }
    this.atBuild.length = 0;
    this.drainInto(this.heard);
    this.forgetLeaving();
    return this.heard;
  }

  /**
   * Draws the bodies onto their entities once the frame's ticks have run, in
   * their order: parents first.
   *
   * The step runs at the project's rate and the screen at its own. Drawn at its
   * last tick, a body stood still on every other frame at 120 Hz, and on three
   * frames out of four at a quarter of the time scale. A body that asks is
   * drawn between its last two ticks instead.
   *
   * @param alpha How far the world's clock has run into the next tick, below
   *   one: the world takes in no more time than the ticks it may run, and runs
   *   them.
   */
  writeBack(alpha: number): void {
    for (let i = 0; i < this.order.length; i += 1) this.order[i]?.draw(alpha);
  }

  /**
   * A step of Rapier's pipeline, handed what `World.step` hands it, without
   * what `World.step` does next: walk every handle through a callback from
   * WebAssembly, and each of its JS tables, to map what WebAssembly made and
   * unmap what it removed — 600 KB a step for a thousand bodies, asleep or not.
   * Nothing is made or removed in there: what the world makes or removes is in
   * or out of those tables at once, which `rapier.test.ts` holds Rapier to.
   */
  private step(): void {
    const world = this.world;
    world.physicsPipeline.step(
      world.gravity,
      world.integrationParameters,
      world.islands,
      world.broadPhase,
      world.narrowPhase,
      world.bodies,
      world.colliders,
      world.softBodies,
      world.impulseJoints,
      world.multibodyJoints,
      world.ccdSolver,
      this.events,
    );
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

  /**
   * What the world holds, its own tables and Rapier's: what a spawn adds and its
   * destroy gives back, for a test, a checkpoint or a probe to see balance.
   */
  get stats(): {
    readonly bodies: number;
    readonly colliders: number;
    readonly joints: number;
    readonly rapierBodies: number;
    readonly rapierColliders: number;
    readonly rapierJoints: number;
  } {
    let joints = 0;
    for (const held of this.joints.values()) joints += held.length;
    return {
      bodies: this.bodies.size,
      colliders: this.owners.size,
      joints,
      // The sizes of Rapier's JS tables, each set's `len()` being its map's.
      rapierBodies: this.world.bodies.len(),
      rapierColliders: this.world.colliders.len(),
      rapierJoints: this.world.impulseJoints.len(),
    };
  }

  /**
   * The ids below come from a behaviour, which holds them as text: each is read
   * as the id it has to be, and one that is none finds nothing.
   */
  body(entityId: string): BodyHandle | null {
    return isEntityId(entityId) ? (this.bodies.get(entityId) ?? null) : null;
  }

  /** The first Joint on the entity that holds: one tuned to hold nothing reads as none. */
  joint(entityId: string): JointHandle | null {
    if (!isEntityId(entityId)) return null;
    return this.joints.get(entityId)?.find((joint) => joint.holds) ?? null;
  }

  createCharacterController(
    entityId: string,
    settings: CharacterSettings,
  ): CharacterController | null {
    const body = isEntityId(entityId) ? this.bodies.get(entityId) : undefined;
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

  /** A Rigid Body patched on the body made from it. Level geometry has none, and takes none. */
  private tuneBody(entityId: EntityId, rigidbody: RigidBodyComponent): void {
    const body = this.bodies.get(entityId);
    if (!body?.rigidbody || body.rigidbody.id !== rigidbody.id) return;
    const moved = rigidbody.bodyType !== body.rigidbody.bodyType;
    body.tune(rigidbody, describeBody(rigidbody));
    // Each collider is built for its body's type: Triangles on a Dynamic body
    // are their hull.
    if (moved) for (const built of body.colliders) this.tuneCollider(built, built.component, body, true);
    this.weighAgain(body);
  }

  /**
   * A built collider given a Collider's values, its handle kept: the table of
   * owners stands, a character sweeps its tuned shape on its tuned layer, and
   * the queries find it as tuned from the next tick.
   *
   * A mesh's shape is built again only when its build, its body's type
   * (`reshape`) or its entity's meshes moved: it is built from their vertices,
   * which a friction slider must not pay at every step of a drag. Rapier
   * builds any other shape in no time.
   */
  private tuneCollider(built: Built, component: ColliderComponent, body: Body, reshape: boolean): void {
    const { collider } = built;
    const was = built.component.shape;
    const meshes = component.shape.kind === 'mesh' ? ownMeshes(built.carrier) : NO_MESHES;
    const keeps =
      !reshape &&
      component.shape.kind === 'mesh' &&
      was.kind === 'mesh' &&
      component.shape.build === was.build &&
      sameMeshes(meshes, built.meshes);
    const desc = describeCollider(
      component,
      built.carrier,
      built.scale,
      body.rigidbody?.bodyType ?? 'fixed',
      built.frame,
      this.materialOf(component),
      this.groupsOf(component.layer),
      keeps ? collider.shape : undefined,
    );
    if (desc.shape !== collider.shape) collider.setShape(desc.shape);
    // The offset whether it moved or not. Rapier keeps a contact's friction and
    // bounce from when it was made: a box resting on a slope held at friction
    // 0 until its collider's offset was set again, which remade its contacts
    // with the new values, and reported no event.
    collider.setTranslationWrtParent(desc.translation);
    collider.setRotationWrtParent(desc.rotation);
    collider.setFriction(desc.friction);
    collider.setRestitution(desc.restitution);
    collider.setFrictionCombineRule(desc.frictionCombineRule);
    collider.setRestitutionCombineRule(desc.restitutionCombineRule);
    collider.setSensor(desc.isSensor);
    collider.setCollisionGroups(desc.collisionGroups);
    collider.setActiveEvents(desc.activeEvents);
    collider.setActiveCollisionTypes(desc.activeCollisionTypes);
    built.component = component;
    built.meshes = meshes;
  }

  /**
   * A body weighed again — a sensor weighs nothing, and a shape changes each
   * collider's share — and woken. A setter's own wake did not keep a sleeping
   * ball awake: its gravity reversed, it read awake, fell asleep again at the
   * next step and never moved. `wakeUp()` did.
   */
  private weighAgain(body: Body): void {
    if (body.rigidbody) weigh(body.rapier, body.colliders.map(({ collider }) => collider), body.rigidbody.mass);
    if (body.rapier.isDynamic()) body.rapier.wakeUp();
  }

  /**
   * The two bodies a joint holds, as they were made, by the rule the world's
   * warnings read; `null` when it holds nothing — an end not made yet, or gone,
   * until a pass gives it one.
   */
  private endsOf(entityId: EntityId, joint: JointComponent): JointBodies | null {
    const ends = jointEnds(this.scene, entityId, joint);
    if (!ends.holds) return null;
    const own = this.bodies.get(ends.own);
    const other = ends.other === null ? this.ground() : this.bodies.get(ends.other);
    return own && other ? { other, own } : null;
  }

  /**
   * The world a joint with no Connected Body is held to: one fixed body at the
   * origin, with no collider. No entity owns it, so `body()` never answers
   * with it.
   */
  private ground(): Placed {
    this.grounding ??= {
      rapier: this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed()),
      built: { position: new Vector3(), quaternion: new Quaternion() },
    };
    return this.grounding;
  }

  /**
   * The body `entityId` sits on, made at its object's world pose when it has
   * none yet: of its Rigid Body's kind, or fixed for level geometry. Filed in
   * the drawing order after the bodies as deep as it is.
   */
  private bodyFor(entityId: EntityId): Body | null {
    const existing = this.bodies.get(entityId);
    if (existing) return existing;
    const object = this.objects.getObject(entityId);
    if (!object) return null;

    const rigidbody = findComponent(this.scene, entityId, 'rigidbody') ?? null;
    worldPose(object, _worldPosition, _worldQuaternion, _worldScale);
    const rapier = this.world.createRigidBody(
      describeBody(rigidbody)
        .setTranslation(_worldPosition.x, _worldPosition.y, _worldPosition.z)
        .setRotation({ x: _worldQuaternion.x, y: _worldQuaternion.y, z: _worldQuaternion.z, w: _worldQuaternion.w }),
    );
    // A collider with no rigid body is level geometry: static, and free.
    const driver = DRIVER_OF[rigidbody?.bodyType ?? 'fixed'];
    const depth = entityWorldMatrixPath(this.scene, entityId).length;
    const body = new Body(rapier, entityId, object, driver, rigidbody, depth);
    this.bodies.set(entityId, body);
    let at = this.order.length;
    while (at > 0 && (this.order[at - 1]?.depth ?? 0) > body.depth) at -= 1;
    this.order.splice(at, 0, body);
    this.bodiesMoved = true;
    return body;
  }

  /**
   * A carrier's colliders on the body it rides now: those that left, or ride
   * another body now, given back; those that came built. The bodies they left
   * and joined go into `reweigh`.
   */
  private carry(carrierId: EntityId, reweigh: Set<Body>): void {
    const components = this.scene.entities.has(carrierId) ? findComponents(this.scene, carrierId, 'collider') : [];
    const bodyId = components.length === 0 ? null : (bodyOf(this.scene, carrierId) ?? carrierId);
    const kept: Built[] = [];
    for (const built of this.carried.get(carrierId) ?? []) {
      if (built.owner.body === bodyId && components.some((component) => component.id === built.component.id)) {
        kept.push(built);
        continue;
      }
      const left = this.bodies.get(built.owner.body);
      this.unbuild(built);
      if (left) reweigh.add(left);
    }

    const body = bodyId === null ? null : this.bodyFor(bodyId);
    if (body) {
      for (const component of components) {
        if (kept.some((built) => built.component.id === component.id)) continue;
        const built = this.buildCollider(carrierId, component, body);
        if (built) kept.push(built);
      }
      reweigh.add(body);
    }
    if (kept.length > 0) this.carried.set(carrierId, kept);
    else this.carried.delete(carrierId);
  }

  /**
   * A collider on `body`, at its carrier's place on it and its carrier's world
   * scale, both read from where the two stand now: the carrier's own pose on its
   * own body, q_B⁻¹ · q_C at q_B⁻¹ · (p_C − p_B) on another's.
   */
  private buildCollider(carrierId: EntityId, component: ColliderComponent, body: Body): Built | null {
    const carrier = this.objects.getObject(carrierId);
    if (!carrier) return null;
    worldPose(body.object, _worldPosition, _worldQuaternion, _worldScale);
    const frame: Frame = { position: new Vector3(), quaternion: new Quaternion() };
    const scale = _worldScale.clone();
    if (carrier !== body.object) {
      worldPose(carrier, _carrierPosition, _carrierQuaternion, scale);
      frame.quaternion.copy(_worldQuaternion).invert();
      frame.position.copy(_carrierPosition).sub(_worldPosition).applyQuaternion(frame.quaternion);
      frame.quaternion.multiply(_carrierQuaternion);
    }

    const material = this.materialOf(component);
    const groups = this.groupsOf(component.layer);
    const bodyType = body.rigidbody?.bodyType ?? 'fixed';
    const collider = this.world.createCollider(
      describeCollider(component, carrier, scale, bodyType, frame, material, groups),
      body.rapier,
    );
    const meshes = component.shape.kind === 'mesh' ? ownMeshes(carrier) : NO_MESHES;
    const owner = { entity: carrierId, body: body.entityId };
    const built: Built = { owner, component, carrier, meshes, scale, frame, collider };
    this.owners.set(collider.handle, built);
    body.colliders.push(built);
    return built;
  }

  /** A collider given back, its owner kept until the next tick's events have named it. */
  private unbuild(built: Built): void {
    const body = this.bodies.get(built.owner.body);
    const at = body?.colliders.indexOf(built) ?? -1;
    if (at >= 0) body?.colliders.splice(at, 1);
    this.leaving.push(built.collider.handle);
    this.world.removeCollider(built.collider, true);
  }

  /** A body of another kind now: its colliders given back, their carriers into `carriers`, and the body taken away. */
  private takeDown(body: Body, carriers: Set<EntityId>): void {
    for (const built of [...body.colliders]) {
      carriers.add(built.owner.entity);
      this.carried.delete(built.owner.entity);
      this.unbuild(built);
    }
    this.removeBody(body);
  }

  /** Whether its entity still needs it: one with a Rigid Body, or one carrying colliders. */
  private needed(body: Body): boolean {
    return (
      this.scene.entities.has(body.entityId) &&
      (body.colliders.length > 0 || hasComponent(this.scene, body.entityId, 'rigidbody'))
    );
  }

  private removeBody(body: Body): void {
    // Its joints let go first: Rapier takes a body's joints with it, and one
    // taken so would be removed a second time when it is built again.
    for (const held of this.joints.values()) {
      for (const joint of held) if (joint.holdsBody(body.rapier)) joint.remake(joint.component, null);
    }
    this.world.removeRigidBody(body.rapier);
    this.bodies.delete(body.entityId);
    const at = this.order.indexOf(body);
    if (at >= 0) this.order.splice(at, 1);
    this.bodiesMoved = true;
  }

  /**
   * A Joint, read against its entity's world pose and scale now, between the
   * bodies it holds now, or holding nothing until a pass gives it ends.
   */
  private makeJoint(entityId: EntityId, component: JointComponent): void {
    const object = this.objects.getObject(entityId);
    if (!object || !this.scene.entities.has(entityId)) return;
    worldPose(object, _worldPosition, _worldQuaternion, _worldScale);
    const placed = {
      position: _worldPosition.clone(),
      quaternion: _worldQuaternion.clone(),
      scale: _worldScale.clone(),
    };
    const joint = new Joint(this.world, component, placed, this.endsOf(entityId, component));
    const held = this.joints.get(entityId);
    if (held) held.push(joint);
    else this.joints.set(entityId, [joint]);
  }

  /** What the colliders taken out since the last read of events were, now that their events are read. */
  private forgetLeaving(): void {
    for (let i = 0; i < this.leaving.length; i += 1) {
      const handle = this.leaving[i];
      if (handle !== undefined) this.owners.delete(handle);
    }
    this.leaving.length = 0;
  }

  dispose(): void {
    this.bodies.clear();
    this.order.length = 0;
    this.carried.clear();
    this.joints.clear();
    this.owners.clear();
    this.triggers.clear();
    this.touched.clear();
    // Rapier says a queue must be freed by hand, and `world.free()` leaves it.
    this.events.free();
    this.world.free();
  }

  /**
   * The tick's events, by entity, onto the end of `heard`.
   *
   * Rapier's queue is read whole before the world is asked where any pair
   * touches, so nothing calls into Rapier from inside its own loop.
   */
  private drainInto(heard: PhysicsEvent[]): void {
    this.drained.length = 0;
    this.events.drainCollisionEvents(this.onCollisionEvent);
    for (let i = 0; i < this.drained.length; i += 1) {
      const event = this.drained[i];
      if (event === undefined) continue;
      const { first, second, started } = event;
      const a = this.owners.get(first);
      const b = this.owners.get(second);
      // Every collider the world builds is in the table.
      if (!a || !b) continue;
      const sides = { a: a.owner, b: b.owner };
      const pair = first < second ? `${first} ${second}` : `${second} ${first}`;
      if (started ? a.component.isSensor || b.component.isSensor : this.triggers.has(pair)) {
        if (started) this.triggers.add(pair);
        else this.triggers.delete(pair);
        heard.push({ ...sides, kind: started ? 'triggerEnter' : 'triggerExit' });
      } else if (!started) {
        heard.push({ ...sides, kind: 'collisionExit' });
      } else {
        heard.push({ ...sides, kind: 'collisionEnter', contact: this.contactOf(a.collider, b.collider) });
      }
    }
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
    const exclude = options?.exclude;
    const excluded = exclude !== undefined && isEntityId(exclude) ? this.bodies.get(exclude)?.rapier : undefined;
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
    const found = new Set<EntityId>();
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

  /**
   * The physics material a collider is built with: the one it links, as the
   * running world plays it (`World.setAssetValues`) or as its file holds it, or
   * the collider's own values where the project cannot answer the link, as an
   * unlinked collider plays them; the world says so.
   */
  private materialOf(collider: ColliderComponent): PhysicsMaterialDef {
    const linked = linkedPhysicsMaterial(collider.materialId, this.materials);
    if (linked === null || collider.materialId === null) return collider.material;
    const played = this.assetValues(collider.materialId);
    return played === undefined ? linked : conformPhysicsMaterial(played);
  }
}

/** Whether two lists hold the same meshes, in the same order. */
function sameMeshes(a: readonly Mesh[], b: readonly Mesh[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
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
  // Set either way: a body weighed again once tuned, whose sensors had carried
  // its mass whole, would carry it on top of its colliders' share.
  body.setAdditionalMass(shared ? 0 : mass, true);
  // A density set on a built collider reaches its body at the next step, and
  // `mass` read before it gave the old one.
  body.recomputeMassPropertiesFromColliders();
}

/** Each body type as Rapier names it. */
const BODY_TYPES: Record<RigidBodyComponent['bodyType'], RAPIER.RigidBodyType> = {
  dynamic: RAPIER.RigidBodyType.Dynamic,
  kinematicPosition: RAPIER.RigidBodyType.KinematicPositionBased,
  fixed: RAPIER.RigidBodyType.Fixed,
};

/**
 * A body as its Rigid Body describes it, on one desc that the build places and
 * a tune reads: its type, its dampings, its gravity scale, its continuous
 * detection and the axes it leaves free. Level geometry, with no Rigid Body,
 * is fixed.
 */
function describeBody(rigidbody: RigidBodyComponent | null): RAPIER.RigidBodyDesc {
  if (!rigidbody) return RAPIER.RigidBodyDesc.fixed();
  const desc = new RAPIER.RigidBodyDesc(BODY_TYPES[rigidbody.bodyType])
    .setLinearDamping(rigidbody.linearDamping)
    .setAngularDamping(rigidbody.angularDamping)
    .setGravityScale(rigidbody.gravityScale)
    .setCcdEnabled(rigidbody.ccd);
  // The solver's alone, as the Inspector shows them: a kinematic body never
  // takes a lock hidden since it stopped being dynamic. Rapier names the axes
  // left free, where the document names those locked.
  if (rigidbody.bodyType === 'dynamic') {
    const { lockPosition: position, lockRotation: rotation } = rigidbody;
    desc.enabledTranslations(!position.x, !position.y, !position.z);
    desc.enabledRotations(!rotation.x, !rotation.y, !rotation.z);
  }
  return desc;
}

/**
 * A collider as Rapier takes it, on one desc that the build creates and a tune
 * reads: built at its entity's world scale by the rules core's
 * `colliderGeometry` writes down for the type of the body it rides; set off
 * and turned on that body by its own centre and rotation, carried through its
 * entity's frame on it; with its material's values, its layer's groups and
 * the events it reports.
 *
 * Around `shape` when one is given: the shape a built collider has, which a
 * tune keeps where it would only build the same one again.
 */
function describeCollider(
  collider: ColliderComponent,
  object: Object3D,
  scale: Vector3,
  bodyType: BodyType,
  frame: Frame,
  material: PhysicsMaterialDef,
  groups: number,
  shape?: RAPIER.Shape,
): RAPIER.ColliderDesc {
  const { x: sx, y: sy, z: sz } = scale;
  const { shape: built, position, rotation } = colliderGeometry(collider.shape, [sx, sy, sz], bodyType);
  _colliderPosition.set(...position).applyQuaternion(frame.quaternion).add(frame.position);
  // three's Euler XYZ, which is the order `colliderGeometry` turns its axes in.
  _colliderRotation.setFromEuler(_colliderEuler.set(...rotation)).premultiply(frame.quaternion);
  return (
    (shape ? new RAPIER.ColliderDesc(shape) : describeShape(built, object))
      .setTranslation(_colliderPosition.x, _colliderPosition.y, _colliderPosition.z)
      .setRotation(_colliderRotation)
      .setFriction(material.friction)
      .setRestitution(material.restitution)
      .setFrictionCombineRule(COMBINE_RULES[material.frictionCombine])
      .setRestitutionCombineRule(COMBINE_RULES[material.restitutionCombine])
      .setSensor(collider.isSensor)
      // Every collider, not the sensors alone: one matrix decides what
      // touches, what a sensor sees and what a character sweeps, its
      // collider's groups being its sweep's filter. Rapier tests the groups
      // beside a sensor's active types, not instead of them: a fixed sensor
      // with the kinematic pairs below saw nothing on a layer its own ignores.
      .setCollisionGroups(groups)
      // Every collider asks. Rapier reports a pair when either side does, so
      // what a pair reports never depends on which side asked; and only when
      // it changes, so a scene at rest reports nothing.
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
      .setActiveCollisionTypes(collider.isSensor ? SENSOR_PAIRS : RAPIER.ActiveCollisionTypes.DEFAULT)
  );
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
  return holdingPose({ position: _worldPosition, quaternion: _worldQuaternion, scale: _worldScale }, joint);
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
