import type { SceneDoc, Transform } from '@three-studio/core';
import { Euler, Matrix4, Quaternion, Vector3 } from 'three/webgpu';

/*
 * Moving an entity between parents without moving it on screen.
 *
 * A transform is stored relative to its parent, so changing the parent changes
 * what the same numbers mean. Every editor preserves the world placement across
 * a reparent — Unity's `SetParent` defaults to it — because the alternative is
 * that dragging a row in the hierarchy teleports the object.
 *
 * The maths lives in the editor rather than in core: core has no dependencies
 * on purpose, and re-deriving matrix decomposition by hand to keep it that way
 * would be a lot of subtle code to own.
 */

const scratchPosition = new Vector3();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchEuler = new Euler();

function localMatrix(transform: Transform): Matrix4 {
  return new Matrix4().compose(
    scratchPosition.fromArray(transform.position),
    scratchQuaternion.setFromEuler(scratchEuler.fromArray(transform.rotation)),
    scratchScale.fromArray(transform.scale),
  );
}

/** Where an entity sits in the world, by walking its chain of parents. */
export function worldMatrix(scene: SceneDoc, id: string | null): Matrix4 {
  if (id === null) return new Matrix4();

  const entity = scene.entities[id];
  if (!entity) return new Matrix4();

  return worldMatrix(scene, entity.parent).multiply(localMatrix(entity.transform));
}

/**
 * The transform an entity needs under `parentId` to stay exactly where it is.
 *
 * A matrix can hold shear, which position/rotation/scale cannot, so a parent
 * with non-uniform scale *and* rotation will not round-trip perfectly. Unity
 * has the same limit and the same answer: the common cases are exact, and the
 * one that is not was already unrepresentable.
 */
export function localTransformUnder(
  scene: SceneDoc,
  id: string,
  parentId: string | null,
): Transform {
  const world = worldMatrix(scene, id);
  const local = worldMatrix(scene, parentId).invert().multiply(world);
  return transformFromMatrix(local);
}

export function transformFromMatrix(matrix: Matrix4): Transform {
  matrix.decompose(scratchPosition, scratchQuaternion, scratchScale);
  scratchEuler.setFromQuaternion(scratchQuaternion);

  return {
    position: [scratchPosition.x, scratchPosition.y, scratchPosition.z],
    rotation: [scratchEuler.x, scratchEuler.y, scratchEuler.z],
    scale: [scratchScale.x, scratchScale.y, scratchScale.z],
  };
}

/**
 * Where an entity has to sit locally so that a world-space delta has moved it.
 *
 * The multi-object gizmo drives a synthetic pivot rather than any one object, so
 * there is nothing to read a result back from: the gesture produces a delta
 * matrix, and each target's new pose is *computed*. `delta × world` is the pose
 * in world space; dividing out the parent puts it back in the entity's own terms.
 *
 * Doing it this way is also what makes rotation and scale turn around the pivot
 * rather than around each object's own origin, which is what Unity and Blender
 * do — three Eulers added together would not.
 */
export function localTransformAfterDelta(
  scene: SceneDoc,
  id: string,
  delta: Matrix4,
): Transform {
  const world = delta.clone().multiply(worldMatrix(scene, id));
  const entity = scene.entities[id];
  const local = worldMatrix(scene, entity?.parent ?? null).invert().multiply(world);
  return transformFromMatrix(local);
}

/** A world matrix that is a pure move, for placing something at a point. */
export function translationMatrix(at: readonly [number, number, number]): Matrix4 {
  return new Matrix4().makeTranslation(at[0], at[1], at[2]);
}

/** Where an entity stands in the world, ignoring how it got there. */
export function worldPosition(scene: SceneDoc, id: string): [number, number, number] {
  const elements = worldMatrix(scene, id).elements;
  return [elements[12] ?? 0, elements[13] ?? 0, elements[14] ?? 0];
}
