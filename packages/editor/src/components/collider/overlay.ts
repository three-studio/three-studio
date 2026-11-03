import {
  bodyOf,
  colliderGeometry,
  findComponent,
  type ColliderComponent,
  type ComponentDoc,
  type MeshBuild,
  type SceneDoc,
} from '@three-studio/core';
import { SceneBinder, collectVertices, ownMeshes, worldPose } from '@three-studio/runtime';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import {
  BufferAttribute,
  BufferGeometry,
  EdgesGeometry,
  Euler,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Quaternion,
  Vector3,
  WireframeGeometry,
  type Mesh,
  type Object3D,
} from 'three/webgpu';
import { annotation, type ComponentHelper, type HelperHandle } from '../../viewport/overlay/ComponentHelper';
import type { EntityMarker } from '../registry';
import { outlineOf } from './outline';

/** Unity's collider green, so a collider reads as one in either editor. */
const COLOUR = 0x91f48b;

/**
 * A collider drawn as physics builds it.
 *
 * From the document, through `colliderGeometry`, at the pose physics reads its
 * entity at (`worldPose`), for the type of the body it rides (`bodyOf`): the
 * builder's own rules at the builder's own inputs, so what is drawn and what is
 * built cannot disagree — a collider whose size was copied from its mesh once,
 * when it was added, shows the gap the mesh has grown since. A mesh collider is
 * drawn from the vertices physics builds it from, its own entity's meshes, as
 * its triangles or as the hull they make, Triangles under a dynamic body
 * included.
 */
export class ColliderOutline implements ComponentHelper<'collider'> {
  readonly type = 'collider';

  // Never `null`: a mesh collider on a model still loading has nothing to draw
  // now, and lines a moment later.
  mount(_component: ColliderComponent, source: Object3D): HelperHandle {
    return annotation(new ColliderLines(source));
  }
}

class ColliderLines extends LineSegments<BufferGeometry, LineBasicMaterial> {
  private readonly entityId: string | undefined;
  private positions = new BufferAttribute(new Float32Array(0), 3);
  /**
   * What a mesh collider's lines were drawn from. Rebuilt only when it changes —
   * an edited primitive gets a new geometry, a model that finishes loading new
   * meshes — so a frame with nothing new hulls nothing.
   */
  private drawnFrom: MeshSource | null = null;

  constructor(private readonly source: Object3D) {
    super(
      new BufferGeometry(),
      new LineBasicMaterial({
        color: COLOUR,
        fog: false,
        toneMapped: false,
        // Its lines lie on the faces of the mesh it fits, and a depth test cut
        // them into dashes. Drawn through everything, as the selection's box.
        depthTest: false,
        depthWrite: false,
        transparent: true,
      }),
    );
    this.geometry.setAttribute('position', this.positions);
    // The container carries its entity's id, and keeps it for as long as the
    // entity exists.
    this.entityId = SceneBinder.resolveEntityId(source);
    // Placed by hand: the annotation group sits at the world's origin.
    this.matrixAutoUpdate = false;
    // three computes a bounding sphere once, and these points are rewritten in
    // place afterwards: the one it kept would cull the outline at grazing angles.
    this.frustumCulled = false;
  }

  update(component: ComponentDoc, scene: SceneDoc): void {
    if (component.type !== 'collider') return;

    worldPose(this.source, _position, _quaternion, _scale);
    const body = this.entityId === undefined ? null : bodyOf(scene, this.entityId);
    const bodyType = body === null ? undefined : findComponent(scene, body, 'rigidbody')?.bodyType;
    const { shape, position, rotation } = colliderGeometry(
      component.shape,
      [_scale.x, _scale.y, _scale.z],
      bodyType,
    );
    if (shape.kind === 'mesh') {
      this.drawMesh(shape.build);
      // The vertices are the entity's own, unscaled: its scale is the matrix's,
      // so a scale moves the lines and rebuilds none. A linear map keeps a hull
      // a hull, and a flat face flat.
      this.matrix.compose(_position, _quaternion, _scale);
    } else {
      this.drawnFrom = null;
      this.write(outlineOf(shape));
      // The entity's place at unit scale, then the shape's on it: the measures
      // are already at the entity's scale.
      _offset.compose(
        _shapePosition.set(...position),
        _shapeRotation.setFromEuler(_euler.set(...rotation)),
        UNIT,
      );
      this.matrix.compose(_position, _quaternion, UNIT).multiply(_offset);
    }
    // A mesh collider with no mesh of its own draws nothing; Play says why.
    this.visible = this.positions.count > 0;
  }

  /** The lines of a mesh collider, from the vertices physics builds it from. */
  private drawMesh(build: MeshBuild): void {
    const meshes = ownMeshes(this.source);
    const from = this.drawnFrom;
    if (
      from?.build === build &&
      from.meshes.length === meshes.length &&
      meshes.every((mesh, i) => from.meshes[i]?.mesh === mesh && from.meshes[i]?.geometry === mesh.geometry)
    ) {
      return;
    }
    this.drawnFrom = { build, meshes: meshes.map((mesh) => ({ mesh, geometry: mesh.geometry })) };
    const vertices = collectVertices(this.source, [1, 1, 1]);
    this.write(vertices ? meshLines(vertices.positions, vertices.indices, build) : new Float32Array(0));
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }

  /**
   * In place while the count holds, as when a size is dragged; a new geometry
   * when it changes, as when a rounding is switched on, since a buffer cannot
   * grow. Nothing when nothing changed.
   */
  private write(outline: Float32Array): void {
    const current = this.positions.array;
    if (outline.length === current.length) {
      if (outline.every((value, i) => value === current[i])) return;
      this.positions.copyArray(outline);
      this.positions.needsUpdate = true;
      return;
    }
    this.geometry.dispose();
    this.positions = new BufferAttribute(outline, 3);
    this.geometry = new BufferGeometry().setAttribute('position', this.positions);
  }
}

/** A mesh collider's build, and each of its meshes with the geometry it held. */
interface MeshSource {
  readonly build: MeshBuild;
  readonly meshes: readonly { readonly mesh: Mesh; readonly geometry: BufferGeometry }[];
}

/**
 * A mesh collider's lines, in its entity's frame and units: every edge of its
 * triangles, or of their hull. Convex parts are drawn as their triangles: V-HACD
 * cuts them in the runtime alone.
 */
function meshLines(positions: Float32Array, indices: Uint32Array, build: MeshBuild): Float32Array {
  if (build === 'hull') {
    const points = Array.from({ length: positions.length / 3 }, (_, i) =>
      new Vector3().fromArray(positions, i * 3),
    );
    const hull = new ConvexGeometry(points);
    // At a degree apart, two triangles of one face are one face.
    if (solid(hull)) return linesOf(new EdgesGeometry(hull, 1));
  }
  const triangles = new BufferGeometry()
    .setAttribute('position', new BufferAttribute(positions, 3))
    .setIndex(new BufferAttribute(indices, 1));
  return linesOf(new WireframeGeometry(triangles));
}

/**
 * Whether three hulled the points. It hulls no flat soup — a plane, a disc —
 * and hands back a sliver of four of its points, which drew a disc's hull as a
 * triangle; its triangles are drawn instead. Rapier hulls it flat.
 */
function solid(hull: BufferGeometry): boolean {
  const corners = hull.getAttribute('position');
  let volume = 0;
  for (let i = 0; i + 2 < corners.count; i += 3) {
    _a.fromBufferAttribute(corners, i);
    _b.fromBufferAttribute(corners, i + 1);
    _c.fromBufferAttribute(corners, i + 2);
    volume += _a.dot(_b.cross(_c)) / 6;
  }
  hull.computeBoundingBox();
  const span = hull.boundingBox?.getSize(_a).length() ?? 0;
  return volume > 1e-9 * span ** 3;
}

/** The pairs of points one of three's line geometries holds. */
function linesOf(geometry: BufferGeometry): Float32Array {
  return Float32Array.from(geometry.getAttribute('position').array);
}

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _position = new Vector3();
const _quaternion = new Quaternion();
const _scale = new Vector3();
const _shapePosition = new Vector3();
const _shapeRotation = new Quaternion();
const _euler = new Euler();
const _offset = new Matrix4();
/** Never written. */
const UNIT = new Vector3(1, 1, 1);

/** The shape physics uses is not the shape the author sees. */
export const drawsGeometry = false;

/**
 * No marker. A collider is on something already drawn, and the annotation worth
 * having for it is an outline of the shape itself, which `ColliderOutline` draws
 * while it is selected.
 */
export const marker: EntityMarker | null = null;

export const helper = new ColliderOutline();
