import {
  bodyOf,
  colliderGeometry,
  findComponent,
  type ColliderComponent,
  type ComponentDoc,
  type SceneDoc,
} from '@three-studio/core';
import { SceneBinder, worldPose } from '@three-studio/runtime';
import {
  BufferAttribute,
  BufferGeometry,
  Euler,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Quaternion,
  Vector3,
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
 * when it was added, shows the gap the mesh has grown since.
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
    // Not drawn yet.
    if (shape.kind === 'mesh') {
      this.visible = false;
      return;
    }

    this.visible = true;
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
