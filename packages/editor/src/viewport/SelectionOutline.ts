import { Box3, Box3Helper, Color, Group, type LineBasicMaterial, type Object3D } from 'three/webgpu';

const SELECTED_COLOR = new Color('#ff9d3d');

/**
 * Draws a bounding box around the selection.
 *
 * A box rather than a silhouette outline on purpose: the outline pass in
 * three's post-processing stack is WebGL-only, and the WebGPU equivalent would
 * pull a whole node-based post pipeline into the MVP for a selection highlight.
 *
 * Nothing is drawn around an object with **no extent** — a light, a camera, a
 * bare group. Its marker turns the same orange instead, which says the same
 * thing without inventing a size the object does not have: the cube that used to
 * stand there was 0.35 units wide because that number had to be picked, and it
 * read as a box *around* something rather than as the thing itself. The bound is
 * still computed, and that half must survive; see `bounds`.
 */
export class SelectionOutline {
  readonly root = new Group();

  private readonly helpers = new Map<string, Box3Helper>();
  private readonly box = new Box3();

  constructor() {
    this.root.name = 'SelectionOutline';
    // Helpers must never be picked or contribute to a bounding-box computation.
    this.root.raycast = () => undefined;
  }

  /** Union of what `update` last measured, so `bounds` costs nothing. */
  private lastBounds: Box3 | null = null;

  /** Call every frame; cheap while selections stay small. */
  update(selection: readonly string[], resolve: (id: string) => Object3D | undefined): void {
    for (const [id, helper] of this.helpers) {
      if (!selection.includes(id)) {
        helper.removeFromParent();
        helper.dispose();
        this.helpers.delete(id);
      }
    }

    const total = new Box3();
    let found = false;

    for (const id of selection) {
      const object = resolve(id);
      if (!object) continue;

      /*
       * `precise: false`, and once per frame.
       *
       * `true` transforms every vertex of every descendant into world space.
       * This ran here *and* again in `bounds`, both every frame for as long as
       * anything was selected — so selecting a 550k-triangle mesh cost two full
       * vertex walks per frame to draw a wireframe box. The loose bound is the
       * object's bounding box put through its matrix: a fraction of the work,
       * and for a box drawn around a selection the difference is invisible.
       */
      this.box.setFromObject(object);
      /*
       * Lights and cameras have no renderable extent. The box is still made —
       * `bounds()` feeds the orbit pivot and the F shortcut, and both need
       * something to aim at — but nothing is drawn around it: the entity's
       * marker carries the selection colour instead.
       */
      const hasExtent = !this.box.isEmpty();
      if (!hasExtent) {
        object.getWorldPosition(this.box.min);
        this.box.max.copy(this.box.min);
        this.box.expandByScalar(0.35);
      }

      total.union(this.box);
      found = true;

      if (!hasExtent) {
        // It may have had one a frame ago: a mesh added to a light's entity, or
        // a model that has just finished loading.
        const stale = this.helpers.get(id);
        if (stale) {
          stale.removeFromParent();
          stale.dispose();
          this.helpers.delete(id);
        }
        continue;
      }

      let helper = this.helpers.get(id);
      if (!helper) {
        helper = new Box3Helper(this.box.clone(), SELECTED_COLOR);
        helper.raycast = () => undefined;
        helper.renderOrder = 999;
        // Selection must stay legible through the object it surrounds and
        // through anything in front of it — otherwise a selected object behind
        // a wall looks unselected. `Box3Helper` always builds a single
        // `LineBasicMaterial`, never an array.
        const material = helper.material as LineBasicMaterial;
        material.depthTest = false;
        material.depthWrite = false;
        material.transparent = true;
        this.helpers.set(id, helper);
        this.root.add(helper);
      } else {
        helper.box.copy(this.box);
      }
    }

    this.lastBounds = found ? total : null;
  }

  /**
   * World-space bounds of the selection, for the orbit pivot and the F shortcut.
   *
   * Whatever `update` measured this frame. It used to walk every vertex again
   * for an answer it had just computed.
   *
   * It covers what has no extent as well as what has, which is why the box for
   * those is still made even though none is drawn: answering `null` for a light
   * would leave `F` and the orbit pivot with nothing to aim at, and framing a
   * light is exactly when an author reaches for `F`.
   */
  bounds(): Box3 | null {
    return this.lastBounds;
  }

  dispose(): void {
    for (const helper of this.helpers.values()) helper.dispose();
    this.helpers.clear();
    this.root.clear();
  }
}
