import { isPlaceable, type EntityTemplate, type Transform, type Vec3 } from '@three-studio/core';
import { peekViewport } from '../viewport/viewportHost';
import { addEntity } from './sceneCommands';

/*
 * Where an object created from the Add menu goes.
 *
 * The positions the factories in `@three-studio/core` hand back used to be places:
 * a cube at `(0, 0.5, 0)`, a camera at `(0, 2, 8)`, always the same spot no
 * matter where the author was looking. Fly fifty metres from the origin, add a
 * cube, and it appears behind you — which is what "it lands in strange places"
 * meant.
 *
 * Here they are read as *offsets* from a placement point instead, which is what
 * makes them mean something: the camera's `(0, 2, 8)` becomes "two up and eight
 * back from what I am looking at", the point light's `(0, 3, 0)` becomes "three
 * metres above it", and the mesh's resting offset becomes "sitting on it".
 * Nothing needed a per-type rule.
 *
 * The point itself comes from `EditorViewport.placementPoint`, which is Unity's
 * and Unreal's answer: trace through the centre of the view, land on whatever
 * surface is there, fall back to the horizontal plane through the orbit pivot,
 * then to a fixed distance ahead.
 *
 * **Always at the root, never under the selection.** Unity parents a new object
 * to whatever happened to be selected and it is the single most complained-about
 * thing about its Add menu — you get a hierarchy you did not ask for from a
 * selection you had forgotten about. Unreal and Blender both add at the top and
 * leave nesting to a deliberate gesture, which is the drag in the hierarchy
 * panel or Cmd+G. This does the same.
 */

/**
 * The template's own transform, moved so it lands at `point`.
 *
 * Position only: rotation and scale describe how the thing sits, not where, and
 * a flat plane or an angled sun light means the same at every point.
 */
export function placedAt(transform: Transform, point: Vec3): Transform {
  const [x, y, z] = transform.position;
  return { ...transform, position: [point[0] + x, point[1] + y, point[2] + z] };
}

/** Add through the Add menu: at the root, where the view is pointed. */
export function addEntityInView(template: EntityTemplate): string {
  // No viewport means no view to place against — under vitest, or before the
  // canvas exists. The factory's own offset is then the whole answer.
  const hit = isPlaceable(template) ? peekViewport()?.placementPoint() : undefined;
  if (hit) {
    // Positioned before insertion so the whole add stays one undo step.
    template.entity.transform = placedAt(template.entity.transform, [hit.x, hit.y, hit.z]);
  }
  return addEntity(template);
}
