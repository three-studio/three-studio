import {
  createAssetId,
  colliderType,
  createColliderShape,
  createComponentForEntity,
  createEntity,
  jointType,
  createMeshEntity,
  createPhysicsSettings,
  playerControllerType,
  createRenderingSettings,
  rigidbodyType,
  scriptType,
  type AssetId,
  type BodyType,
  type ColliderComponent,
  type ComponentOfType,
  type ComponentType,
  type EntityId,
  type EntityTemplate,
  type GeometryKind,
  type JointComponent,
  type PhysicsMaterialDef,
  type PhysicsSettings,
  type PlayerControllerComponent,
  type RigidBodyComponent,
  type Vec3,
} from '@three-studio/core';
import { Quaternion, Vector3 } from 'three/webgpu';
import { onTestFinished } from 'vitest';
import { sceneWith } from '../../../core/test/fixtures';

export { nest } from '../../../core/test/fixtures';
import { World } from '../../src/world/World';
import { AssetCache } from '../../src/assets/AssetCache';
import { NULL_ASSET_RESOLVER } from '../../src/assets/AssetResolver';
import type { AudioClipCache } from '../../src/audio/AudioClipCache';
import type { AudioContextLike } from '../../src/audio/AudioContextLike';
import type { BodyHandle } from '../../src/physics/PhysicsApi';
import type { RuntimeRegistries } from '../../src/registries';
import type { ScriptClass, ScriptClasses } from '../../src/scripting/scriptBundle';
import { physicsOf } from '../../src/physics/physicsOf';
import { builtInRegistries } from '../registries';
import { StudioTime } from '../../src/time/StudioTime';

const registries = builtInRegistries();

/**
 * The script each template runs, by the asset id its component names: what
 * `withScript` gave it, which the rig hands its world as a build's bundle.
 */
const scriptsOf = new WeakMap<EntityTemplate, readonly (readonly [AssetId, ScriptClass])[]>();

/*
 * A scene document running in the real `World`, with real Rapier, under Node.
 *
 * The world rather than a binder and a physics world beside it: Play, a device
 * and an exported build all run this `World`, so a test that drove physics on its
 * own would test an order of calls no game ever makes. Frames go through
 * `World.frame`, behaviours are built as the world builds them, and warnings
 * land in `world.warnings`.
 */

export interface Pose {
  readonly position: Vector3;
  readonly quaternion: Quaternion;
}

export interface PhysicsRig {
  readonly world: World;
  /**
   * Whole frames through `World.frame`: of one fixed step each, or of
   * `1 / framesPerSecond`, as a display of that rate draws them.
   */
  run(seconds: number, framesPerSecond?: number): void;
  /** Holds a key down on the rig's own canvas, as a person typing into the game. */
  press(code: string): void;
  release(code: string): void;
  /**
   * Where the entity is drawn: its object's world pose.
   *
   * Up to a tick behind its solved pose for a body drawn between ticks, which
   * a new body and a character are. A test comparing the two builds its bodies
   * with `{ interpolate: false }`, or compares them at rest.
   */
  drawn(entityId: EntityId): Pose;
  /** Where the solver holds its body, read through the API a behaviour reads it through. */
  solved(entityId: EntityId): Pose;
  /** The entity's body, as a behaviour is handed it. */
  body(entityId: EntityId): BodyHandle;
}

/**
 * These entities in a running world, disposed when the test finishes, with the
 * project's physics materials by asset id.
 */
export type PhysicsRigMaker = (
  entities: readonly EntityTemplate[],
  settings?: Partial<PhysicsSettings>,
  physicsMaterials?: ReadonlyMap<AssetId, PhysicsMaterialDef>,
) => Promise<PhysicsRig>;

/** A rig whose world runs on the kernel's systems and behaviours, as a root activates them. */
export const physicsRig: PhysicsRigMaker = physicsRigOn(registries);

/** What a rig's world is handed besides its scene. */
export interface RigOptions {
  /** For a test of what it plays. */
  readonly audioContext?: AudioContextLike;
  /** The clips it plays, decoded by a loader of the test's. */
  readonly audioCache?: AudioClipCache;
  /** Batching on, for a test of the batches; off otherwise, see below. */
  readonly batching?: boolean;
}

/**
 * Rigs whose worlds run on these registries: a test file that registers a
 * behaviour or a subsystem of its own builds its own registries, so what it adds
 * reaches no other file.
 */
export function physicsRigOn(registries: RuntimeRegistries, options: RigOptions = {}): PhysicsRigMaker {
  return (entities, settings, physicsMaterials) =>
    runningRig(registries, entities, settings, physicsMaterials, options);
}

async function runningRig(
  registries: RuntimeRegistries,
  entities: readonly EntityTemplate[],
  settings: Partial<PhysicsSettings> | undefined,
  physicsMaterials: ReadonlyMap<AssetId, PhysicsMaterialDef> | undefined,
  { audioContext, audioCache, batching = false }: RigOptions,
): Promise<PhysicsRig> {
  const physicsSettings = { ...createPhysicsSettings(), ...settings };
  const canvas = new EventTarget();
  const world = await World.play({
    time: new StudioTime(),
    document: sceneWith(entities),
    registries,
    scripts: bundleOf(entities),
    assets: new AssetCache(registries, { resolver: NULL_ASSET_RESOLVER, idleBudgetBytes: 0 }),
    // Batching off unless asked: a batched mesh is drawn by the batch, and the
    // object a test reads would be one the screen never shows.
    rendering: { ...createRenderingSettings(), batching },
    physicsSettings,
    physicsMaterials,
    element: canvas as unknown as HTMLElement,
    // Heard on the canvas rather than on the window, which every test file
    // shares: two rigs alive in one test cannot hear each other's keys.
    input: { keys: 'element' },
    audioContext,
    audioCache,
  });
  onTestFinished(() => world.dispose());

  const step = physicsSettings.fixedTimestep;
  const body = (entityId: EntityId): BodyHandle => {
    const built = physicsOf(world)?.body(entityId);
    if (!built) throw new Error(`No body was built for "${entityId}".`);
    return built;
  };

  return {
    world,
    run(seconds, framesPerSecond) {
      // The step itself rather than `1 / (1 / step)`, which can come out an ulp
      // short of it: a frame that short runs no tick.
      const delta = framesPerSecond ? 1 / framesPerSecond : step;
      const frames = Math.round(seconds / delta);
      for (let frame = 0; frame < frames; frame++) world.frame(delta);
    },
    press(code) {
      canvas.dispatchEvent(keyEvent('keydown', code));
    },
    release(code) {
      canvas.dispatchEvent(keyEvent('keyup', code));
    },
    drawn(entityId) {
      const object = world.binder.getObject(entityId);
      if (!object) throw new Error(`No object is bound to "${entityId}".`);
      object.updateWorldMatrix(true, false);
      const pose = { position: new Vector3(), quaternion: new Quaternion() };
      object.matrixWorld.decompose(pose.position, pose.quaternion, new Vector3());
      return pose;
    },
    solved(entityId) {
      const { position, rotation } = body(entityId);
      return {
        position: new Vector3(position.x, position.y, position.z),
        // Unit length only to within Rapier's single precision, and an angle
        // read off a dot product (`angleTo`) turns a norm 3e-8 short of one
        // into half a milliradian between two poses that are the same.
        quaternion: new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w).normalize(),
      };
    },
    body,
  };
}

/** A key as `Input` reads one: where it is on the keyboard, and no modifier held. */
function keyEvent(type: 'keydown' | 'keyup', code: string): Event {
  return Object.assign(new Event(type), {
    code,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
  });
}

/**
 * What a running world needs of the browser: `Input` listens on `window` and
 * `document`, which event targets stand in for.
 *
 * `performance` too: Rapier times each step with the window's clock once there
 * is a window, and a window without one makes `world.step()` panic with nothing
 * but `unreachable` to say why.
 *
 * Called by each test file in `beforeAll` rather than by this module when it is
 * imported, so a reader of the test sees where `window` comes from.
 */
export function standInForTheBrowser(): void {
  Object.assign(globalThis, {
    window: Object.assign(new EventTarget(), { performance }),
    document: new EventTarget(),
  });
}

/** Taken back down: a global left behind is one this file wrote for another file to find. */
export function takeTheBrowserBack(): void {
  Reflect.deleteProperty(globalThis, 'window');
  Reflect.deleteProperty(globalThis, 'document');
}

/** A collider-only 40 × 1 × 40 box, its top face through the origin, tilted about z. */
export function ground(tiltDegrees = 0): EntityTemplate {
  const tilt = (tiltDegrees * Math.PI) / 180;
  const template = createEntity('Ground', [
    { ...colliderType.create(), shape: { ...createColliderShape('box'), size: [40, 1, 40] } },
  ]);
  // Half its thickness below the surface along the tilted normal, so whatever
  // the tilt the slope passes through the origin, and a body placed above it
  // has the same drop.
  template.entity.transform.position = [0.5 * Math.sin(tilt), -0.5 * Math.cos(tilt), 0];
  template.entity.transform.rotation = [0, 0, tilt];
  return template;
}

/**
 * A primitive with a dynamic rigid body, of these settings, and the collider
 * `createComponentForEntity` guesses for it.
 */
export function withBody(
  kind: GeometryKind,
  position: Vec3,
  body?: Partial<RigidBodyComponent>,
): EntityTemplate {
  const template = createMeshEntity(kind);
  template.components.push(
    { ...rigidbodyType.create(), ...body },
    createComponentForEntity(registries, 'collider', template.components),
  );
  template.entity.transform.position = position;
  return template;
}

/** A primitive with the collider `createComponentForEntity` guesses for it, and no body: `withBody`'s sibling. */
export function withCollider(kind: GeometryKind, position: Vec3): EntityTemplate {
  const template = createMeshEntity(kind);
  template.components.push(createComponentForEntity(registries, 'collider', template.components));
  template.entity.transform.position = position;
  return template;
}

/**
 * What Add Component ▸ Player Controller builds on an empty entity: the
 * controller, a 1.70 m capsule and a kinematic body. It faces −z.
 */
export function player(
  position: Vec3,
  {
    controller,
    bodyType = 'kinematicPosition',
  }: { controller?: Partial<PlayerControllerComponent>; bodyType?: BodyType } = {},
): EntityTemplate {
  const template = createEntity('Player', [
    { ...playerControllerType.create(), ...controller },
    {
      ...colliderType.create(),
      shape: { ...createColliderShape('capsule'), radius: 0.3, height: 1.7 },
    },
    { ...rigidbodyType.create(), bodyType },
  ]);
  template.entity.transform.position = position;
  return template;
}

/**
 * The template, running `type` as its script.
 *
 * Under an asset id of its own, which the rig's world is handed with the class
 * in its bundle, as a project's compiled bundle pairs each script with its id.
 */
export function withScript(template: EntityTemplate, type: ScriptClass): EntityTemplate {
  const assetId = createAssetId();
  scriptsOf.set(template, [...(scriptsOf.get(template) ?? []), [assetId, type]]);
  template.components.push({ ...scriptType.create(), assetId });
  return template;
}

/** The bundle that runs these templates' scripts, as a build would compile it. */
export function bundleOf(templates: readonly EntityTemplate[]): ScriptClasses {
  return new Map(templates.flatMap((template) => scriptsOf.get(template) ?? []));
}

/**
 * The template, holding a Joint: a hinge to the world unless `joint` says
 * otherwise. A test names the other side by its template's entity id.
 */
export function withJoint(template: EntityTemplate, joint?: Partial<JointComponent>): EntityTemplate {
  template.components.push({ ...jointType.create(), ...joint });
  return template;
}

/** Collider-only level geometry, a step or a wall: a box of this full size. */
export function block(position: Vec3, size: Vec3): EntityTemplate {
  const template = createEntity('Block', [
    { ...colliderType.create(), shape: { ...createColliderShape('box'), size } },
  ]);
  template.entity.transform.position = position;
  return template;
}

/** `block`'s sibling that touches nothing: a box of this full size, its Collider *Is sensor*. */
export function sensor(position: Vec3, size: Vec3): EntityTemplate {
  const template = createEntity('Sensor', [
    { ...colliderType.create(), shape: { ...createColliderShape('box'), size }, isSensor: true },
  ]);
  template.entity.transform.position = position;
  return template;
}

/** The template, each Collider it carries on this collision layer. */
export function onLayer(template: EntityTemplate, layerId: string): EntityTemplate {
  for (const component of template.components) {
    if (component.type === 'collider') component.layer = layerId;
  }
  return template;
}

/** The template's collider, so a test can set its shape or material before the rig is built. */
export function colliderOf(template: EntityTemplate): ColliderComponent {
  return componentOf(template, 'collider');
}

/**
 * The template's first component of this type: to set before the rig is
 * built, or to tune with a spread once it runs.
 */
export function componentOf<T extends ComponentType>(template: EntityTemplate, type: T): ComponentOfType<T> {
  const found = template.components.find((component): component is ComponentOfType<T> => component.type === type);
  if (!found) throw new Error(`"${template.entity.name}" has no ${type} component.`);
  return found;
}
