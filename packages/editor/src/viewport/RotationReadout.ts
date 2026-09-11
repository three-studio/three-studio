import {
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  Quaternion,
  Sprite,
  SpriteNodeMaterial,
  Vector3,
} from 'three/webgpu';

/*
 * What a rotation gesture looks like while it is happening.
 *
 * `TransformControls` draws almost nothing during a rotate drag. Its whole
 * rotate helper is one line:
 *
 *     const helperRotate = { AXIS: [[ new Line( lineGeometry, matHelper ), … ]] };
 *
 * An infinite line down the axis, and that is all — no swept sector, no angle.
 * In Local that is survivable, because the rings turn with the object and the
 * gesture is visible in them. In Global the rings are the *world's* axes and
 * correctly do not move, so the only thing that changes on screen is the object
 * itself. The editor's own author read that as a broken gizmo, twice, which is
 * a fair reading of an interface that gives no feedback for the thing you are
 * doing. Unity and Blender both draw the sector and the number.
 */

/** Radius of three's rotate rings, in gizmo units — `CircleGeometry( 0.5, … )`. */
const RING_RADIUS = 0.5;

/** One triangle per this much arc, so a slow drag does not look faceted. */
const RADIANS_PER_SEGMENT = Math.PI / 48;

/**
 * Enough for two and a bit full turns before the arc starts to coarsen.
 *
 * A cap rather than a growing buffer: the gesture can pass a full turn as many
 * times as the pointer keeps moving, and reallocating a `BufferGeometry`
 * mid-drag is the one thing here that would be felt.
 */
const MAX_SEGMENTS = 192;

/** Three's own handle colours, so the sector belongs to the ring it came from. */
const HANDLE_COLOURS: Readonly<Record<string, number>> = {
  X: 0xff0000,
  Y: 0x00ff00,
  Z: 0x0000ff,
  E: 0xffff00,
  XYZE: 0x787878,
};

const LABEL_PIXELS = { width: 256, height: 128 } as const;

/**
 * The world axis a rotation is turning about, from what three left behind.
 *
 * **This is the one subtle line in the file.** `rotationAxis` is not in a fixed
 * space: three leaves it in whichever frame it last needed it in, and the
 * branch it took decides which.
 *
 * - Local, on a single axis handle, it is `_unit[axis]` — the *pivot's own*
 *   frame, untouched (`TransformControls.js`, the `space === 'local'` branch of
 *   the rotate case).
 * - Every other path runs it through `applyQuaternion( this._parentQuaternionInv )`
 *   first, which lands it in the pivot's **parent** frame.
 *
 * That parent is `transformGizmo`, and `createEditorProjection` guarantees it
 * carries the identity — "a requirement, not a tidy default", for the light and
 * camera helpers that take a world matrix as their own. So the second case is
 * already world and only the first needs turning.
 *
 * Pure, and exported, because it is the part that can be wrong without anything
 * looking wrong: a sector in the correct plane is hard to tell from a sector in
 * the wrong one until the object is turned twice.
 */
export function gestureAxis(options: {
  /** `TransformControls.axis` — which handle is held. */
  handle: string | null;
  /** The space three itself was using, not ours. */
  space: 'world' | 'local';
  rotationAxis: Vector3;
  /** The pivot's world quaternion when the drag began. */
  frame: Quaternion;
}): Vector3 {
  const { handle, space, rotationAxis, frame } = options;

  const inPivotFrame = space === 'local' && (handle === 'X' || handle === 'Y' || handle === 'Z');
  const axis = rotationAxis.clone();

  return (inPivotFrame ? axis.applyQuaternion(frame) : axis).normalize();
}

/**
 * Where the sector starts: the grabbed point, flattened into the plane.
 *
 * Blender and Unity both anchor the sector to where the pointer took hold
 * rather than to a fixed axis, so the filled wedge is literally the ground the
 * pointer has covered. `pointStart` is that grab, as an offset from the pivot.
 */
export function arcStart(axis: Vector3, grab: Vector3): Vector3 {
  const flattened = grab.clone().addScaledVector(axis, -grab.dot(axis));

  // A grab straight down the axis has nothing to flatten — it happens when the
  // ring is edge-on and the pointer lands on its centre. Any perpendicular does:
  // the sector is a sliver seen from there whatever we pick.
  if (flattened.lengthSq() < 1e-12) {
    const seed = Math.abs(axis.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
    return seed.cross(axis).normalize();
  }

  return flattened.normalize();
}

/**
 * The world size of one gizmo unit, for a perspective camera.
 *
 * Three's own arithmetic, copied rather than approximated — `screenScale()` in
 * `overlay/` answers a similar question and would land close, but *close* is
 * exactly what this must not be: the sector has to sit on the ring, and a ring
 * drawn from one formula with a sector drawn from another is a seam an author
 * sees immediately.
 */
export function gizmoUnit(options: {
  /** Pivot to camera. */
  distance: number;
  fovDegrees: number;
  zoom: number;
  /** `TransformControls.size`. */
  size: number;
}): number {
  const { distance, fovDegrees, zoom, size } = options;

  const factor = distance * Math.min((1.9 * Math.tan((Math.PI * fovDegrees) / 360)) / zoom, 7);
  return (factor * size) / 4;
}

/** Everything the readout needs for one frame of one gesture. */
export interface RotationGesture {
  /** World point the rotation turns about. */
  centre: Vector3;
  /** Unit axis in world space — see `gestureAxis`. */
  axis: Vector3;
  /** Where on the ring the pointer took hold, as an offset from `centre`. */
  grab: Vector3;
  /** Signed radians turned so far. Unbounded: a gesture may pass a full turn. */
  angle: number;
  /** Which handle is held, for the colour. */
  handle: string | null;
  /** World size of one gizmo unit — see `gizmoUnit`. */
  unit: number;
}

/**
 * The swept sector and the angle, drawn during a rotate drag.
 *
 * Lives in the scene rather than in React, and that is not a preference:
 * `viewportStore` says in as many words that the viewport publishes to React on
 * a timer "so React re-renders a few times a second instead of sixty". A number
 * that follows the pointer cannot be a few times a second. So the label is a
 * texture the class paints itself — and only when the rounded degree actually
 * changes, which is a handful of uploads per gesture rather than one per frame.
 *
 * `Sprite` is ruled out for entity markers because `Sprite.raycast` computes its
 * quad from the world scale; that does not apply here. `Picker` casts rays at
 * `binder.root` and at `overlay.markers` only, and this hangs from
 * `transformGizmo`, which no ray ever reaches.
 */
export class RotationReadout {
  readonly root = new Group();

  private readonly arc: Mesh;
  private readonly arcMaterial: MeshBasicNodeMaterial;
  private readonly positions: Float32BufferAttribute;

  private readonly label: Sprite;
  private readonly labelMaterial: SpriteNodeMaterial;
  private readonly labelTexture: CanvasTexture;
  private readonly labelContext: CanvasRenderingContext2D | null;

  /** The degrees currently painted, so a frame that changes nothing paints nothing. */
  private painted: number | null = null;

  constructor() {
    this.root.name = 'RotationReadout';
    this.root.visible = false;
    // Drawn after the handles it sits among, all of which ignore depth.
    this.root.renderOrder = 1;

    // A fan of loose triangles rather than an indexed one. The index would be
    // fixed and the positions rewritten anyway, so the index buys nothing and
    // costs a second buffer to keep in step with `setDrawRange`.
    this.positions = new Float32BufferAttribute(new Float32Array(MAX_SEGMENTS * 3 * 3), 3);
    this.positions.setUsage(DynamicDrawUsage);

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', this.positions);

    this.arcMaterial = new MeshBasicNodeMaterial({
      color: HANDLE_COLOURS.X,
      transparent: true,
      opacity: 0.3,
      side: DoubleSide,
      // The same rule the markers and the outline follow: an annotation about
      // the gesture must not be swallowed by the thing the gesture is moving.
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    this.arc = new Mesh(geometry, this.arcMaterial);
    // The positions are rewritten every frame and never bounded, so a bounding
    // sphere computed once would cull the sector the moment it grew past it.
    this.arc.frustumCulled = false;

    const canvas = document.createElement('canvas');
    canvas.width = LABEL_PIXELS.width;
    canvas.height = LABEL_PIXELS.height;
    this.labelContext = canvas.getContext('2d');

    this.labelTexture = new CanvasTexture(canvas);
    this.labelMaterial = new SpriteNodeMaterial({
      map: this.labelTexture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    this.label = new Sprite(this.labelMaterial);
    this.label.frustumCulled = false;

    this.root.add(this.arc, this.label);
  }

  /** Nothing is being rotated; draw nothing and forget what was painted. */
  hide(): void {
    this.root.visible = false;
    this.painted = null;
  }

  /** Redraws the sector and the number for one frame of a gesture. */
  show(gesture: RotationGesture): void {
    const { centre, axis, grab, angle, handle, unit } = gesture;

    this.root.visible = true;
    this.arcMaterial.color.setHex(
      (handle === null ? undefined : HANDLE_COLOURS[handle]) ?? HANDLE_COLOURS.XYZE ?? 0x787878,
    );

    const radius = RING_RADIUS * unit;
    const start = arcStart(axis, grab);

    const segments = Math.max(
      1,
      Math.min(MAX_SEGMENTS, Math.ceil(Math.abs(angle) / RADIANS_PER_SEGMENT)),
    );

    // Written about the centre rather than in world coordinates: the sector is a
    // handful of centimetres across and the scene may be kilometres from the
    // origin, which is where a float32 position buffer starts to shimmer.
    this.arc.position.copy(centre);

    const array = this.positions.array as Float32Array;
    const step = new Quaternion();
    const edge = new Vector3();

    for (let i = 0; i < segments; i += 1) {
      const from = (angle * i) / segments;
      const to = (angle * (i + 1)) / segments;
      const base = i * 9;

      array[base] = 0;
      array[base + 1] = 0;
      array[base + 2] = 0;

      edge.copy(start).applyQuaternion(step.setFromAxisAngle(axis, from)).multiplyScalar(radius);
      array[base + 3] = edge.x;
      array[base + 4] = edge.y;
      array[base + 5] = edge.z;

      edge.copy(start).applyQuaternion(step.setFromAxisAngle(axis, to)).multiplyScalar(radius);
      array[base + 6] = edge.x;
      array[base + 7] = edge.y;
      array[base + 8] = edge.z;
    }

    this.positions.needsUpdate = true;
    this.arc.geometry.setDrawRange(0, segments * 3);

    // Riding the leading edge, just outside the ring, so the number sits where
    // the pointer already is instead of asking the eye to go and find it.
    edge.copy(start).applyQuaternion(step.setFromAxisAngle(axis, angle));
    this.label.position.copy(centre).addScaledVector(edge, radius * 1.35);
    this.label.scale.set(unit * 1.1, (unit * 1.1 * LABEL_PIXELS.height) / LABEL_PIXELS.width, 1);

    this.paint(Math.round((angle * 180) / Math.PI));
  }

  dispose(): void {
    this.arc.geometry.dispose();
    this.arcMaterial.dispose();
    this.labelTexture.dispose();
    this.labelMaterial.dispose();
    this.root.removeFromParent();
  }

  /** Repaints the label, and only when the number a person can read has changed. */
  private paint(degrees: number): void {
    if (this.painted === degrees) return;
    this.painted = degrees;

    const context = this.labelContext;
    if (context === null) return;

    const { width, height } = LABEL_PIXELS;
    context.clearRect(0, 0, width, height);

    context.font = '600 64px ui-sans-serif, system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    // Stroked before filled: the number lands on whatever the scene happens to
    // be, and a bright scene eats white text as thoroughly as a dark one eats
    // black.
    const text = `${degrees}°`;
    context.lineWidth = 8;
    context.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    context.strokeText(text, width / 2, height / 2);
    context.fillStyle = '#ffffff';
    context.fillText(text, width / 2, height / 2);

    this.labelTexture.needsUpdate = true;
  }
}
