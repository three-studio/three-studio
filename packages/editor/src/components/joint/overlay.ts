import type { ComponentDoc, JointComponent, Vec3 } from '@three-studio/core';
import { jointPose, worldPose } from '@three-studio/runtime';
import {
  BufferAttribute,
  BufferGeometry,
  LineBasicMaterial,
  LineSegments,
  Quaternion,
  Vector3,
  type Object3D,
} from 'three/webgpu';
import { annotation, type ComponentHelper, type HelperHandle } from '../../viewport/overlay/ComponentHelper';
import type { EntityMarker } from '../registry';
import { jointOutline } from './outline';

/** Apart from the collider's green and the selection's orange. */
const COLOUR = 0x4fc3f7;

/** How far its axis and its arcs reach from the anchor, in metres. */
const SIZE = 0.5;

/**
 * A joint drawn where physics builds it: its anchor, its axis and its limits,
 * through the pose the world builds it at (`jointPose`), so the two cannot
 * disagree. From its own entity alone: the other side is the hierarchy's
 * business, and Play's.
 */
export class JointShape implements ComponentHelper<'joint'> {
  readonly type = 'joint';

  mount(_component: JointComponent, source: Object3D): HelperHandle {
    return annotation(new JointLines(source));
  }
}

class JointLines extends LineSegments<BufferGeometry, LineBasicMaterial> {
  private positions = new BufferAttribute(new Float32Array(0), 3);

  constructor(private readonly source: Object3D) {
    super(
      new BufferGeometry(),
      new LineBasicMaterial({
        color: COLOUR,
        fog: false,
        toneMapped: false,
        // An anchor sits inside the meshes it joins.
        depthTest: false,
        depthWrite: false,
        transparent: true,
      }),
    );
    this.geometry.setAttribute('position', this.positions);
    // Placed by hand: the annotation group sits at the world's origin.
    this.matrixAutoUpdate = false;
    // Rewritten in place, so the bounding sphere three keeps would cull it.
    this.frustumCulled = false;
  }

  update(component: ComponentDoc): void {
    if (component.type !== 'joint') return;
    const { position, quaternion } = jointPose(this.source, component);
    // Where a hinge was built: from its anchor towards its entity's origin,
    // across its axis — a door's leaf, for a hinge on its edge. With none, the
    // joint's own +Y.
    worldPose(this.source, _origin, _quaternion, _scale);
    _toOrigin.copy(_origin).sub(position).applyQuaternion(_unturn.copy(quaternion).invert()).setX(0);
    const zero: Vec3 = _toOrigin.lengthSq() > 1e-12 ? _toOrigin.normalize().toArray() : [0, 1, 0];
    this.write(jointOutline(component.motion, SIZE, zero));
    this.matrix.compose(position, quaternion, UNIT);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }

  /** In place while the count holds; a new geometry when it changes. Nothing when nothing changed. */
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

const _origin = new Vector3();
const _quaternion = new Quaternion();
const _scale = new Vector3();
const _toOrigin = new Vector3();
const _unturn = new Quaternion();
/** Never written. */
const UNIT = new Vector3(1, 1, 1);

/** A joint holds bodies together; what is drawn is theirs. */
export const drawsGeometry = false;

/**
 * No marker. A joint sits on a body, which has a shape to click, or on an
 * empty child at a door's edge, which the hierarchy names; selected, it is
 * drawn where it holds.
 */
export const marker: EntityMarker | null = null;

export const helper = new JointShape();
