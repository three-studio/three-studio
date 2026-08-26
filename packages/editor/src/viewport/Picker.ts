import { SceneBinder, isVisibleInHierarchy } from '@three-studio/runtime';
import { Raycaster, Vector2, Vector3, type Camera, type Object3D } from 'three/webgpu';

/**
 * Turns a click into an entity id.
 *
 * Isolated behind its own class because the naive `Raycaster` used here stops
 * scaling once scenes get large; swapping in `three-mesh-bvh` should be a
 * change to this file alone.
 */
export class Picker {
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();

  /**
   * @param pickable Whether a click may land on this entity at all. Injected
   *   rather than read from a store so this class stays testable and knows
   *   nothing about the document — see ADR-5.
   * @param overlay Editor-only stand-ins for entities that draw nothing, tested
   *   *before* the scene. Injected as a bare `Object3D` for the same reason:
   *   this class needs a root to raycast, not a notion of what a marker is.
   */
  constructor(
    private readonly binder: SceneBinder,
    private readonly pickable: (entityId: string) => boolean = () => true,
    private readonly overlay: Object3D | null = null,
  ) {}

  private get root(): Object3D {
    return this.binder.root;
  }

  /**
   * @param x Client-space pointer x.
   * @param y Client-space pointer y.
   * @param rect Bounding rect of the canvas the pointer is over.
   */
  pick(x: number, y: number, rect: DOMRect, camera: Camera): string | undefined {
    this.aim(x, y, rect, camera);

    const marked = this.pickOverlay();
    if (marked !== undefined) return marked;

    for (const hit of this.raycaster.intersectObject(this.root, true)) {
      /*
       * B7. `hit.object.visible` is the mesh's own flag, and hiding an entity
       * sets it on the *container* above it — three does not inherit `visible`,
       * and its raycaster does not test it at all, so a hidden object stayed
       * clickable and `dropPoint` placed things on invisible surfaces.
       *
       * Both halves are needed. The object's own flag still skips the members of
       * a batch, which are hidden individually — the batch answers for them, one
       * line down. The walk up answers the author's question, and starts at the
       * parent on purpose: see `isVisibleInHierarchy`, where asking about a
       * mesh's own flag is a loop.
       */
      if (!hit.object.visible || !isVisibleInHierarchy(hit.object)) continue;

      // A batch belongs to no entity, so walking up from it finds nothing.
      // `BatchedMesh.raycast` says which instance was hit, and that is the
      // object the click meant.
      const batchId = (hit as { batchId?: number }).batchId;
      if (batchId !== undefined) {
        const owner = this.binder.resolveBatchHit(hit.object, batchId);
        // Skipped, not refused: a click on a locked object selects whatever is
        // behind it, which is what "excluded from picking" means and what Unity
        // does. Returning here instead would make the lock a hole in the scene.
        if (owner !== undefined && this.pickable(owner)) return owner;
        continue;
      }

      const entityId = SceneBinder.resolveEntityId(hit.object);
      if (entityId !== undefined && this.pickable(entityId)) return entityId;
    }
    return undefined;
  }

  /**
   * The entity whose marker the cursor is over, before the scene is consulted.
   *
   * Priority rather than distance, and it is a decision rather than an accident:
   * a marker is *drawn* over everything, so it has to be *clickable* over
   * everything. Sorted with the scene instead, a wall in front of a light would
   * leave an icon that plainly says "here I am" and refuses the click.
   */
  private pickOverlay(): string | undefined {
    const overlay = this.overlay;
    if (overlay === null) return undefined;

    for (const hit of this.raycaster.intersectObject(overlay, true)) {
      // The same two halves as below, and the same reason — three's raycaster
      // tests neither flag. Here it also carries the Gizmos toggle: switching
      // the overlay off hides the group, and a hidden marker must not be
      // clickable.
      if (!hit.object.visible || !isVisibleInHierarchy(hit.object)) continue;

      const entityId = SceneBinder.resolveEntityId(hit.object);
      if (entityId !== undefined && this.pickable(entityId)) return entityId;
    }
    return undefined;
  }

  /** World-space point under the cursor, or `null` when nothing is there. */
  raycast(x: number, y: number, rect: DOMRect, camera: Camera): Vector3 | null {
    this.aim(x, y, rect, camera);
    // The overlay is deliberately not consulted: a marker is an annotation, not
    // a surface, and dropping a model onto a light's icon means nothing.
    // Same question as `pick`, and the same reason: what this feeds is
    // `dropPoint`, so getting it wrong drops objects onto hidden geometry.
    const hit = this.raycaster
      .intersectObject(this.root, true)
      .find((it) => it.object.visible && isVisibleInHierarchy(it.object));
    return hit ? hit.point.clone() : null;
  }

  private aim(x: number, y: number, rect: DOMRect, camera: Camera): void {
    this.pointer.set(
      ((x - rect.left) / rect.width) * 2 - 1,
      -((y - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, camera);
  }
}
