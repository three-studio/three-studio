import type { AudioSourceComponent, ComponentDoc } from '@three-studio/core';
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Object3D,
} from 'three/webgpu';
import { annotation, type ComponentHelper, type HelperHandle } from '../ComponentHelper';

/** The green the entity marker already uses, so the two read as one object. */
const NEAR_COLOUR = 0x6ee7a8;
/** Dimmer, because the outer sphere is the boundary and not the subject. */
const FAR_COLOUR = 0x2f7f5e;

/** How far down the axis a cone is drawn, relative to the full-volume radius. */
const CONE_REACH = 3;

/**
 * Segments of a range sphere, matching `PointRange` in `LightShape`.
 *
 * The two are the same idea drawn twice — "this is how far it reaches" — so they
 * should be the same density. Written at 32 × 16 first, and a screenshot settled
 * it: four times the triangles read as a solid ball rather than as a boundary.
 */
const SPHERE_SEGMENTS = 16;

/** Points around a cone's mouth. Cheap, and a circle needs more than a sphere's ring. */
const CONE_SEGMENTS = 24;

/**
 * What a positional sound covers.
 *
 * Drawn from the **document**, not from an audio graph, and that is the whole
 * reason this file is short. There is no `PositionalAudio` to hand to three's
 * `PositionalAudioHelper` (ADR-2), and there does not need to be: the numbers a
 * designer is trying to read — where full volume ends, where the sound stops
 * carrying, which way the cone points — are all fields of the component. The
 * gizmo therefore shows what was *authored*, which is what someone adjusting a
 * slider wants to see, rather than what the mixer happened to make of it.
 *
 * Two spheres and, when the cone is not omnidirectional, two outlines:
 *
 *   * `refDistance` — inside it the sound is at full volume;
 *   * `maxDistance` — the linear model stops attenuating past it, and for the
 *     other two models it is the practical edge of audibility;
 *   * the inner and outer cone angles, down the entity's −Z.
 *
 * **The entity's scale is deliberately ignored.** Web Audio distances are world
 * units; scaling an entity by ten does not make its sound carry ten times
 * further, so a gizmo that grew with the scale would be a confident lie.
 */
export class AudioShape implements ComponentHelper<'audioSource'> {
  readonly type = 'audioSource' as const;

  mount(component: AudioSourceComponent, source: Object3D): HelperHandle | null {
    // A flat sound has no distance and no direction. Its marker already says
    // where its entity is, which is all that is true about it — the same answer
    // an ambient light's helper gives.
    if (component.spatialBlend <= 0) return null;
    return annotation(new AudioRange(source));
  }
}

class AudioRange extends Group {
  private readonly near: Mesh<SphereGeometry, MeshBasicMaterial>;
  private readonly far: Mesh<SphereGeometry, MeshBasicMaterial>;
  private readonly innerCone: LineSegments<BufferGeometry, LineBasicMaterial>;
  private readonly outerCone: LineSegments<BufferGeometry, LineBasicMaterial>;

  private readonly worldPosition = new Vector3();
  private readonly worldRotation = new Quaternion();
  private readonly worldScale = new Vector3();

  constructor(private readonly source: Object3D) {
    super();
    // Composed here rather than inherited: the annotation group sits at the
    // world origin, and this has to be placed by the entity's transform minus
    // its scale.
    this.matrixAutoUpdate = false;

    this.near = sphere(NEAR_COLOUR);
    this.far = sphere(FAR_COLOUR);
    this.innerCone = cone(NEAR_COLOUR);
    this.outerCone = cone(FAR_COLOUR);
    this.add(this.near, this.far, this.innerCone, this.outerCone);
  }

  update(component: ComponentDoc): void {
    if (component.type !== 'audioSource') return;

    // `mount` refuses a source that was already flat when it was selected, but
    // that is the only moment it is asked. Dialling 2D ↔ 3D down to zero while
    // the entity stays selected changes nothing `SelectionHelpers` keys on — the
    // anchor is the entity container, and its identity never moves — so the
    // gizmo was only ever asked to update, and went on drawing distances for a
    // sound that no longer has any.
    this.visible = component.spatialBlend > 0;
    if (!this.visible) return;

    this.source.updateWorldMatrix(true, false);
    this.source.matrixWorld.decompose(this.worldPosition, this.worldRotation, this.worldScale);
    // Unit scale, on purpose — see the class comment.
    this.matrix.compose(this.worldPosition, this.worldRotation, this.worldScale.setScalar(1));

    this.near.scale.setScalar(Math.max(component.refDistance, 0.01));
    this.far.scale.setScalar(Math.max(component.maxDistance, component.refDistance, 0.01));

    // `360` means omnidirectional, which is what every new source starts as, so
    // the common case draws no cone at all rather than a cone that means nothing.
    const reach = Math.min(component.refDistance * CONE_REACH, component.maxDistance);
    writeCone(this.innerCone, component.coneInnerAngle, reach);
    writeCone(this.outerCone, component.coneOuterAngle, reach);
  }

  dispose(): void {
    for (const child of [this.near, this.far, this.innerCone, this.outerCone]) {
      child.geometry.dispose();
      child.material.dispose();
    }
  }
}

function sphere(colour: number): Mesh<SphereGeometry, MeshBasicMaterial> {
  return new Mesh(
    new SphereGeometry(1, SPHERE_SEGMENTS, SPHERE_SEGMENTS / 2),
    new MeshBasicMaterial({ color: colour, wireframe: true, fog: false, toneMapped: false }),
  );
}

function cone(colour: number): LineSegments<BufferGeometry, LineBasicMaterial> {
  const geometry = new BufferGeometry();
  // A ring of segments plus four spokes back to the apex, as pairs of points.
  const pairs = CONE_SEGMENTS + 4;
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(pairs * 6), 3));
  const lines = new LineSegments(
    geometry,
    new LineBasicMaterial({ color: colour, fog: false, toneMapped: false }),
  );
  lines.visible = false;
  // three computes a bounding sphere once, lazily, and `writeCone` rewrites the
  // vertices in place afterwards — so the sphere it kept is the one it derived
  // from an array of zeros: a point at the entity's origin, radius nothing. The
  // cone would then be culled by anything that does not contain that one point,
  // which is a gizmo that blinks out at grazing angles for no visible reason.
  lines.frustumCulled = false;
  return lines;
}

/**
 * Rewrites a cone's points in place.
 *
 * In place because the angles are dragged, and rebuilding a geometry per frame
 * of a drag allocates one buffer per frame for a shape whose vertex count never
 * changes.
 */
function writeCone(
  lines: LineSegments<BufferGeometry, LineBasicMaterial>,
  angle: number,
  reach: number,
): void {
  // Omnidirectional. Nothing to draw, and drawing a full-width cone would say
  // there is a direction when there is not.
  if (angle >= 360 || reach <= 0) {
    lines.visible = false;
    return;
  }
  lines.visible = true;

  const half = (Math.min(angle, 359) / 2) * (Math.PI / 180);
  const radius = Math.tan(half) * reach;
  const attribute = lines.geometry.getAttribute('position') as BufferAttribute;
  const points = attribute.array as Float32Array;
  // The cone opens along −Z, the direction everything else in this editor calls
  // forward: the runtime behaviour reads it the same way off the same matrix.
  const z = -reach;

  let i = 0;
  const write = (x: number, y: number, zz: number): void => {
    points[i++] = x;
    points[i++] = y;
    points[i++] = zz;
  };

  for (let step = 0; step < CONE_SEGMENTS; step++) {
    const a = (step / CONE_SEGMENTS) * Math.PI * 2;
    const b = ((step + 1) / CONE_SEGMENTS) * Math.PI * 2;
    write(Math.cos(a) * radius, Math.sin(a) * radius, z);
    write(Math.cos(b) * radius, Math.sin(b) * radius, z);
  }
  for (let spoke = 0; spoke < 4; spoke++) {
    const a = (spoke / 4) * Math.PI * 2;
    write(0, 0, 0);
    write(Math.cos(a) * radius, Math.sin(a) * radius, z);
  }
  attribute.needsUpdate = true;
}
