import { entitiesWith, type SceneDoc } from '@three-studio/core';
import { ENTITY_ID_KEY, isVisibleInHierarchy, type SceneBinder } from '@three-studio/runtime';
import {
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  OctahedronGeometry,
  Vector3,
  type PerspectiveCamera,
} from 'three/webgpu';
import { MARKED_TYPES, markerStyleFor, type MarkerStyle } from './markerStyles';
import { screenScale } from './screenScale';

const RENDER_ORDER = 998;
/**
 * What the selection outline draws in, so a marker taken over by the selection
 * reads as the same state rather than as a second convention.
 */
const SELECTED_COLOR = 0xff9d3d;
/** Reused per frame; the marker set is walked every frame. */
const SCRATCH_POSITION = new Vector3();

interface Marker {
  readonly mesh: Mesh;
  readonly style: MarkerStyle;
  /** The style's material, held here so a frame costs no `Map` lookup. */
  readonly material: MeshBasicNodeMaterial;
}

/**
 * A clickable stand-in for every entity that draws nothing.
 *
 * A light and a camera both build an `Object3D` with no geometry, so `Raycaster`
 * never touches them and `Picker` can never name them: they were selectable from
 * the hierarchy and nowhere else. This gives each one a small wireframe
 * octahedron at its origin, held at a constant size on screen.
 *
 * It also carries the selection, in the outline's own colour. That is not
 * decoration: `SelectionOutline` no longer draws a box around something with no
 * extent — the box and the marker were saying the same thing in two shapes, and
 * one of them was a cube around a light that has no size.
 *
 * A `Mesh` with `wireframe: true` rather than `LineSegments`, and that is the
 * point of the shape: it *draws* as lines and *raycasts* as solid triangles, so
 * one object is both the annotation and the click target, with a hit area an
 * author can predict. A `Sprite` would have been the obvious alternative and is
 * the wrong one — `Sprite.raycast` computes its quad from the world scale, so
 * the constant-screen-size trick that makes an icon usable also makes its hit
 * area wrong.
 *
 * The markers hang in a flat group of their own, never under the binder's
 * containers. Parenting them there would inherit the transform and the
 * visibility for free, and cost three things that matter more: the batcher walks
 * that graph, `Box3.setFromObject` would fold a screen-sized quad into the
 * selection bounds the F shortcut frames from, and an entity's own scale would
 * fight the constant-size scaling.
 */
export class EntityMarkers {
  readonly root = new Group();

  /** One shape for every marker; this class builds it and frees it. */
  private readonly geometry = new OctahedronGeometry(1);
  /**
   * One material per style, keyed by the style object itself — the styles are
   * module constants, so identity is a stable key and there is no name to keep
   * in step with anything.
   */
  private readonly materials = new Map<MarkerStyle, MeshBasicNodeMaterial>();
  /** Built on first use, like the others, and freed with them. */
  private selected: MeshBasicNodeMaterial | null = null;
  private readonly markers = new Map<string, Marker>();

  constructor(private readonly binder: SceneBinder) {
    this.root.name = 'EntityMarkers';
  }

  /**
   * Re-derives which entities carry a marker.
   *
   * Structural, and driven by the same dirty set the binder gets.
   *
   * The full pass goes through the component tables rather than the entity
   * table, which it could not do while a bare entity earned a marker: only
   * `Object.keys(scene.entities)` can name an entity that carries nothing. Now
   * that it earns none, the candidates are exactly the entities in four tables
   * plus the markers already standing — a lookup, as ADR-16 asks, in place of
   * the last scan this file had.
   *
   * @param dirty Entity ids to re-read; `undefined` re-reads everything.
   */
  sync(scene: SceneDoc, dirty: ReadonlySet<string> | undefined): void {
    const ids = dirty ?? this.candidates(scene);

    for (const id of ids) {
      const style = markerStyleFor(scene, id);
      const held = this.markers.get(id);

      if (style === undefined) {
        if (held) this.drop(id, held);
        continue;
      }
      // A style change is a different material, and the mesh holds exactly one.
      if (held && held.style === style) continue;
      if (held) this.drop(id, held);

      const material = this.materialFor(style);
      const mesh = new Mesh(this.geometry, material);
      // The only line that makes a marker mean anything: `Picker` walks up from
      // whatever it hits and reads this, exactly as it does for a mesh.
      mesh.userData[ENTITY_ID_KEY] = id;
      mesh.renderOrder = RENDER_ORDER;
      // Nothing hangs under a marker, so its own matrix is its world matrix and
      // three has no reason to walk it.
      mesh.matrixAutoUpdate = true;
      this.markers.set(id, { mesh, style, material });
      this.root.add(mesh);
    }
  }

  /**
   * Call every frame: places each marker, sizes it against the screen, and
   * colours it by whether its entity is selected.
   *
   * @param selected The current selection. A marker is the only thing that says
   *   so for an entity with no extent, now that the outline draws no box around
   *   one.
   */
  update(
    camera: PerspectiveCamera,
    viewportHeight: number,
    selected: ReadonlySet<string>,
  ): void {
    for (const [id, marker] of this.markers) {
      // Swapped rather than tinted: one material per state is shared by every
      // marker in it, where `material.color.set` per frame would mean a material
      // per marker and a uniform upload for each.
      marker.mesh.material = selected.has(id) ? this.selectedMaterial() : marker.material;

      const container = this.binder.getObject(id);
      if (!container) {
        // The document holds it, the binder has not built it yet. Hidden rather
        // than dropped: `sync` owns the set, and this runs between syncs.
        marker.mesh.visible = false;
        continue;
      }

      // Both halves, as in `Picker`: three does not inherit `visible`, and
      // `isVisibleInHierarchy` starts at the parent on purpose.
      marker.mesh.visible = container.visible && isVisibleInHierarchy(container);
      if (!marker.mesh.visible) continue;

      container.getWorldPosition(SCRATCH_POSITION);
      marker.mesh.position.copy(SCRATCH_POSITION);
      marker.mesh.scale.setScalar(
        screenScaleFor(camera, SCRATCH_POSITION, viewportHeight, marker.style.pixels),
      );
    }
  }

  dispose(): void {
    for (const marker of this.markers.values()) marker.mesh.removeFromParent();
    this.markers.clear();
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
    this.selected?.dispose();
    this.selected = null;
    this.geometry.dispose();
    this.root.clear();
  }

  /**
   * Entities that could carry a marker, without reading the entity table.
   *
   * Four tables rather than every entity, which is only possible because a bare
   * entity earns nothing. The markers already standing are in there too: an
   * entity that just lost its light is in no table any more, and dropping it is
   * this pass's job.
   */
  private candidates(scene: SceneDoc): ReadonlySet<string> {
    const ids = new Set(this.markers.keys());
    for (const type of MARKED_TYPES) {
      for (const id of entitiesWith(scene, type)) ids.add(id);
    }
    return ids;
  }

  private drop(id: string, marker: Marker): void {
    // The mesh owns neither its geometry nor its material — both are shared and
    // freed once, in `dispose`. Detaching is the whole of the teardown.
    marker.mesh.removeFromParent();
    this.markers.delete(id);
  }

  private materialFor(style: MarkerStyle): MeshBasicNodeMaterial {
    const held = this.materials.get(style);
    if (held) return held;

    const material = new MeshBasicNodeMaterial({
      color: style.color,
      wireframe: true,
      // A marker behind a wall stays visible and stays clickable — otherwise the
      // icon claims a light is somewhere the click cannot reach. Same rule the
      // selection outline follows.
      depthTest: false,
      depthWrite: false,
      transparent: true,
      // An annotation is not lit and must not be graded with the image.
      toneMapped: false,
    });
    this.materials.set(style, material);
    return material;
  }

  private selectedMaterial(): MeshBasicNodeMaterial {
    this.selected ??= new MeshBasicNodeMaterial({
      color: SELECTED_COLOR,
      wireframe: true,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    });
    return this.selected;
  }
}

/** Split out so `screenScale` stays a function on numbers a test can pin. */
function screenScaleFor(
  camera: PerspectiveCamera,
  target: Vector3,
  viewportHeight: number,
  pixels: number,
): number {
  return screenScale(camera.position.distanceTo(target), camera.fov, viewportHeight, pixels);
}
