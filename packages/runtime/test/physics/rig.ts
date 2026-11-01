import {
  createColliderShape,
  createComponent,
  createComponentForEntity,
  createEntity,
  createMeshEntity,
  createPhysicsSettings,
  createRenderingSettings,
  type BodyType,
  type ColliderComponent,
  type EntityTemplate,
  type GeometryKind,
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
import { Engine } from '../../src/Engine';
import { NULL_ASSET_RESOLVER } from '../../src/assets/AssetResolver';
import type { BodyHandle } from '../../src/physics/PhysicsApi';
import { clearScripts, registerScript, type ScriptClass } from '../../src/scripting/ScriptHost';

/*
 * A scene document running in the real `Engine`, with real Rapier, under Node.
 *
 * The engine rather than a binder and a world beside it: Play, a device and an
 * exported build all run this `Engine`, so a test that drove the world on its
 * own would test an order of calls no game ever makes. Frames go through
 * `Engine.update`, behaviours are built as the engine builds them, and warnings
 * land in `engine.warnings`.
 */

export interface Pose {
  readonly position: Vector3;
  readonly quaternion: Quaternion;
}

export interface PhysicsRig {
  readonly engine: Engine;
  /**
   * Whole frames through `Engine.update`: of one fixed step each, or of
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
  drawn(entityId: string): Pose;
  /** Where the solver holds its body, read through the API a behaviour reads it through. */
  solved(entityId: string): Pose;
  /** The entity's body, as a behaviour is handed it. */
  body(entityId: string): BodyHandle;
}

/**
 * These entities in a running engine, disposed when the test finishes, with the
 * project's physics materials by asset id.
 */
export async function physicsRig(
  entities: readonly EntityTemplate[],
  settings?: Partial<PhysicsSettings>,
  physicsMaterials?: Readonly<Record<string, PhysicsMaterialDef>>,
): Promise<PhysicsRig> {
  const physicsSettings = { ...createPhysicsSettings(), ...settings };
  const canvas = new EventTarget();
  const engine = await Engine.create({
    scene: sceneWith(entities),
    resolver: NULL_ASSET_RESOLVER,
    // Batching off: a batched mesh is drawn by the batch, and the object a test
    // reads would be one the screen never shows.
    rendering: { ...createRenderingSettings(), batching: false },
    physicsSettings,
    physicsMaterials,
    domElement: canvas as unknown as HTMLElement,
    // Heard on the canvas rather than on the window, which every test file
    // shares: two rigs alive in one test cannot hear each other's keys.
    input: { keys: 'element' },
  });
  onTestFinished(() => engine.dispose());

  const step = physicsSettings.fixedTimestep;
  const body = (entityId: string): BodyHandle => {
    const built = engine.physics?.body(entityId);
    if (!built) throw new Error(`No body was built for "${entityId}".`);
    return built;
  };

  return {
    engine,
    run(seconds, framesPerSecond) {
      // The step itself rather than `1 / (1 / step)`, which can come out an ulp
      // short of it: a frame that short runs no tick.
      const delta = framesPerSecond ? 1 / framesPerSecond : step;
      const frames = Math.round(seconds / delta);
      for (let frame = 0; frame < frames; frame++) engine.update(delta);
    },
    press(code) {
      canvas.dispatchEvent(keyEvent('keydown', code));
    },
    release(code) {
      canvas.dispatchEvent(keyEvent('keyup', code));
    },
    drawn(entityId) {
      const object = engine.binder.getObject(entityId);
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
 * What a running engine needs of the browser: `Input` listens on `window` and
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
    { ...createComponent('collider'), shape: { ...createColliderShape('box'), size: [40, 1, 40] } },
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
    { ...createComponent('rigidbody'), ...body },
    createComponentForEntity('collider', template.components),
  );
  template.entity.transform.position = position;
  return template;
}

/** A primitive with the collider `createComponentForEntity` guesses for it, and no body: `withBody`'s sibling. */
export function withCollider(kind: GeometryKind, position: Vec3): EntityTemplate {
  const template = createMeshEntity(kind);
  template.components.push(createComponentForEntity('collider', template.components));
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
    { ...createComponent('playerController'), ...controller },
    {
      ...createComponent('collider'),
      shape: { ...createColliderShape('capsule'), radius: 0.3, height: 1.7 },
    },
    { ...createComponent('rigidbody'), bodyType },
  ]);
  template.entity.transform.position = position;
  return template;
}

/**
 * The template, running `type` as its script.
 *
 * Registered under its class name until the test finishes, as a project's
 * compiled bundle registers each script under its asset id.
 */
export function withScript(template: EntityTemplate, type: ScriptClass): EntityTemplate {
  registerScript(type.name, type);
  onTestFinished(clearScripts);
  template.components.push({ ...createComponent('script'), assetId: type.name });
  return template;
}

/** Collider-only level geometry, a step or a wall: a box of this full size. */
export function block(position: Vec3, size: Vec3): EntityTemplate {
  const template = createEntity('Block', [
    { ...createComponent('collider'), shape: { ...createColliderShape('box'), size } },
  ]);
  template.entity.transform.position = position;
  return template;
}

/** `block`'s sibling that touches nothing: a box of this full size, its Collider *Is sensor*. */
export function sensor(position: Vec3, size: Vec3): EntityTemplate {
  const template = createEntity('Sensor', [
    { ...createComponent('collider'), shape: { ...createColliderShape('box'), size }, isSensor: true },
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
  const collider = template.components.find(
    (component): component is ColliderComponent => component.type === 'collider',
  );
  if (!collider) throw new Error(`"${template.entity.name}" has no Collider.`);
  return collider;
}
