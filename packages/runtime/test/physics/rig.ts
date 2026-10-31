import {
  createComponent,
  createComponentForEntity,
  createEntity,
  createMeshEntity,
  createPhysicsSettings,
  createRenderingSettings,
  type EntityTemplate,
  type GeometryKind,
  type PhysicsSettings,
  type Vec3,
} from '@three-studio/core';
import { Quaternion, Vector3 } from 'three/webgpu';
import { onTestFinished } from 'vitest';
import { sceneWith } from '../../../core/test/fixtures';
import { Engine } from '../../src/Engine';
import { NULL_ASSET_RESOLVER } from '../../src/assets/AssetResolver';

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
  /** Whole frames of one fixed step each, through `Engine.update`. */
  run(seconds: number): void;
  /** Where the entity is drawn: its object's world pose. */
  drawn(entityId: string): Pose;
  /** Where the solver holds its body: the one place a test reads Rapier. */
  solved(entityId: string): Pose;
}

/** These entities in a running engine, disposed when the test finishes. */
export async function physicsRig(
  entities: readonly EntityTemplate[],
  settings?: Partial<PhysicsSettings>,
): Promise<PhysicsRig> {
  const physicsSettings = { ...createPhysicsSettings(), ...settings };
  const engine = await Engine.create({
    scene: sceneWith(entities),
    resolver: NULL_ASSET_RESOLVER,
    // Batching off: a batched mesh is drawn by the batch, and the object a test
    // reads would be one the screen never shows.
    rendering: { ...createRenderingSettings(), batching: false },
    physicsSettings,
    domElement: new EventTarget() as unknown as HTMLElement,
  });
  onTestFinished(() => engine.dispose());

  const step = physicsSettings.fixedTimestep;

  return {
    engine,
    run(seconds) {
      const frames = Math.round(seconds / step);
      for (let frame = 0; frame < frames; frame++) engine.update(step);
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
      const body = engine.physics?.get(entityId)?.body;
      if (!body) throw new Error(`No body was built for "${entityId}".`);
      const translation = body.translation();
      const rotation = body.rotation();
      return {
        position: new Vector3(translation.x, translation.y, translation.z),
        // Unit length only to within Rapier's single precision, and an angle
        // read off a dot product (`angleTo`) turns a norm 3e-8 short of one
        // into half a milliradian between two poses that are the same.
        quaternion: new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w).normalize(),
      };
    },
  };
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
    { ...createComponent('collider'), size: [20, 0.5, 20] },
  ]);
  // Half its thickness below the surface along the tilted normal, so whatever
  // the tilt the slope passes through the origin, and a body placed above it
  // has the same drop.
  template.entity.transform.position = [0.5 * Math.sin(tilt), -0.5 * Math.cos(tilt), 0];
  template.entity.transform.rotation = [0, 0, tilt];
  return template;
}

/** A primitive with a dynamic rigid body and the collider `createComponentForEntity` guesses for it. */
export function withBody(kind: GeometryKind, position: Vec3): EntityTemplate {
  const template = createMeshEntity(kind);
  template.components.push(
    createComponent('rigidbody'),
    createComponentForEntity('collider', template.components),
  );
  template.entity.transform.position = position;
  return template;
}
