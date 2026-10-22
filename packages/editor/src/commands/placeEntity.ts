import {
  createAudioSourceEntity,
  createModelEntity,
  isPlaceable,
  type AssetKind,
  type EntityTemplate,
  type Transform,
  type Vec3,
} from '@three-studio/core';
import { useAssetStore } from '../state/assetStore';
import { isSceneLocked, refuseWhileLocked } from '../state/sceneLock';
import { peekViewport } from '../viewport/viewportHost';
import { instantiatePrefab } from './prefabCommands';
import { addEntity } from './sceneCommands';

/*
 * The two ways a new thing enters the scene from the view: an entry of the Add
 * menu, placed where the view is pointed, and an asset dropped on it, placed
 * where it was let go. Both wait for Stop, and they ask here rather than in the
 * menu or the panel: neither decides anything, and the refusal can be tested.
 *
 * **Where an object created from the Add menu goes.**
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

/** Whether the Add menu's entries can place anything now: what the menu greys on. */
export function canAddInView(): boolean {
  return !isSceneLocked();
}

/**
 * Add through the Add menu: at the root, where the view is pointed.
 *
 * `null` while the game runs: refused, said in the toast, with nothing measured
 * or added — the menu greys its entries, and this is the refusal itself.
 */
export function addEntityInView(template: EntityTemplate): string | null {
  if (!canAddInView()) {
    refuseWhileLocked();
    return null;
  }
  // No viewport means no view to place against — under vitest, or before the
  // canvas exists. The factory's own offset is then the whole answer.
  const hit = isPlaceable(template) ? peekViewport()?.placementPoint() : undefined;
  if (hit) {
    // Positioned before insertion so the whole add stays one undo step.
    template.entity.transform = placedAt(template.entity.transform, [hit.x, hit.y, hit.z]);
  }
  return addEntity(template);
}

/**
 * What a drop on the view can place. The view's `dragover` reads it to decide
 * what it promises: there the browser shows a drag's types but not its data,
 * and an asset's kind is in its types (`assetKindMime`).
 */
export const DROPPABLE_KINDS: readonly AssetKind[] = ['prefab', 'model', 'audio'];

/**
 * A drop on the view: the asset placed where it was let go, selected, in one
 * undo step — a prefab as an instance, a sound as an audio source, a model as a
 * model.
 *
 * Any other kind places nothing, and says nothing. Its drop does arrive — the
 * dock cancels every `dragover` over a panel — and everything that was not a
 * prefab or a sound used to fall through to a model, so a texture, a material
 * or a script dropped here made a model entity pointing at it: an entity that
 * could never load anything, with nothing to say why.
 *
 * While the game runs a placeable drop is refused, in the toast, where the view
 * used to place it — the drop came through the dock during Play as well.
 */
export function placeDroppedAsset(assetId: string, point: Vec3): void {
  const asset = useAssetStore.getState().byId(assetId);
  if (!asset || !DROPPABLE_KINDS.includes(asset.kind)) return;
  if (isSceneLocked()) {
    refuseWhileLocked();
    return;
  }
  const position: Vec3 = [point[0], point[1], point[2]];
  if (asset.kind === 'prefab') {
    instantiatePrefab(assetId, position);
    return;
  }
  const template =
    asset.kind === 'audio'
      ? createAudioSourceEntity(assetId, asset.name)
      : createModelEntity(assetId, asset.name);
  // Positioned before insertion so the drop is a single undo step.
  template.entity.transform.position = position;
  addEntity(template);
}
