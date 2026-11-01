import {
  colliderGeometry,
  createAudioSourceEntity,
  createCameraEntity,
  createColliderShape,
  createComponent,
  createEntity,
  createJoint,
  createJointMotion,
  createLightEntity,
  createMeshComponent,
  createMeshEntity,
  createRenderingSettings,
  findComponent,
  jointFrame,
  putComponent,
  type AudioSourceComponent,
  type BuiltShape,
  type ColliderShape,
  type ComponentDoc,
  type EntityTemplate,
  type JointComponent,
  type JointMotion,
  type MeshBuild,
  type SceneDoc,
  type Vec3,
} from '@three-studio/core';
import { NULL_ASSET_RESOLVER } from '@three-studio/runtime/assets/AssetResolver';
import { worldPose } from '@three-studio/runtime/physics/PhysicsWorld';
import { SceneBinder } from '@three-studio/runtime/SceneBinder';
import { RectAreaLightHelper } from 'three/addons/helpers/RectAreaLightHelper.js';
import {
  Box3,
  BufferAttribute,
  CameraHelper,
  DirectionalLightHelper,
  HemisphereLightHelper,
  LineSegments,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  SpotLightHelper,
  Vector3,
  type Intersection,
  type Object3D,
} from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { nest, sceneWith } from '../../core/test/fixtures';
import { ViewportOverlay } from '../src/viewport/overlay/ViewportOverlay';

/*
 * A light, a camera and a bare group build an `Object3D` with no geometry, so
 * the raycaster never touches them: before this layer they were selectable from
 * the hierarchy and from nowhere else, and invisible in the viewport until they
 * were already selected.
 *
 * These tests are the half a screenshot cannot prove — that the right entities
 * get a marker, that a marker resolves back to its entity, and that an
 * annotation is taken down and freed rather than left pointing at an object the
 * binder has already replaced.
 */

const CAMERA_HEIGHT = 800;

/** The overlay, its binder and a camera, all synced to one scene. */
function mount(scene: SceneDoc): {
  overlay: ViewportOverlay;
  binder: SceneBinder;
  camera: PerspectiveCamera;
  /** Re-runs a frame: the binder, then the overlay, as the viewport does. */
  frame: (next?: SceneDoc, selection?: readonly string[]) => void;
} {
  const binder = new SceneBinder({
    resolver: NULL_ASSET_RESOLVER,
    // The viewport's own settings, so these read the binder the editor builds.
    rendering: createRenderingSettings(),
  });
  const overlay = new ViewportOverlay(binder);
  const camera = new PerspectiveCamera(60, 1.5, 0.1, 1000);
  camera.position.set(0, 0, 10);

  let current = scene;
  const frame = (next?: SceneDoc, selection: readonly string[] = []): void => {
    current = next ?? current;
    binder.sync(current);
    overlay.sync(current, undefined);
    overlay.update(current, selection, camera, CAMERA_HEIGHT, true);
  };

  frame();
  return { overlay, binder, camera, frame };
}

const markerIds = (overlay: ViewportOverlay): string[] =>
  overlay.markers.children.map((child) => SceneBinder.resolveEntityId(child) ?? '?');

/**
 * Read off the composed matrix, not off `.scale`.
 *
 * The helpers that size themselves against a light build their world matrix by
 * hand and leave `matrixAutoUpdate` off, so the transform an author sees is in
 * `matrix` and the `scale` property is still whatever it was constructed with.
 */
function scaleOf(object: Object3D | undefined): Vector3 {
  if (!object) throw new Error('no annotation');
  const scale = new Vector3();
  object.matrix.decompose(new Vector3(), new Quaternion(), scale);
  return scale;
}

/** An entity carrying both, which is what the "draws nothing" rule turns on. */
function litCube(): EntityTemplate {
  const light = createLightEntity('point').components[0];
  if (!light) throw new Error('no light component');
  return createEntity('Lamp', [createMeshComponent('box'), light]);
}

describe('who gets a marker', () => {
  it('gives one to a light and to a camera', () => {
    const light = createLightEntity('point');
    const camera = createCameraEntity();
    const { overlay } = mount(sceneWith([light, camera]));

    expect(markerIds(overlay).sort()).toEqual([light.entity.id, camera.entity.id].sort());
  });

  it('gives none to an entity carrying nothing at all', () => {
    /*
     * The `Scene` node every new scene opens with is one of these, and a marker
     * on it says "an entity is at the origin" — which the hierarchy says better.
     * Naming that node as a special case is ruled out, so the rule has to
     * hold for every bare entity, and it does: a group is scaffolding, and what
     * hangs under it is what gets clicked.
     */
    const { overlay } = mount(sceneWith([createEntity('Scene'), createEntity('Rig')]));

    expect(overlay.markers.children).toHaveLength(0);
  });

  it('gives none to anything that draws its own geometry', () => {
    const { overlay } = mount(sceneWith([createMeshEntity('box')]));

    expect(overlay.markers.children).toHaveLength(0);
  });

  it('gives none to a modelled lamp carrying a light', () => {
    // The mesh is already the click target. A second one on top of it would
    // fight the object it belongs to for every click.
    const { overlay } = mount(sceneWith([litCube()]));

    expect(overlay.markers.children).toHaveLength(0);
  });

  it('drops the marker when the entity gains geometry, and brings it back', () => {
    const light = createLightEntity('point');
    const scene = sceneWith([light]);
    const { overlay, frame } = mount(scene);
    expect(overlay.markers.children).toHaveLength(1);

    putComponent(scene, light.entity.id, createMeshComponent('box'));
    frame(scene);
    expect(overlay.markers.children).toHaveLength(0);
  });

  it('drops the marker with the entity', () => {
    const light = createLightEntity('point');
    const scene = sceneWith([light]);
    const { overlay, frame } = mount(scene);

    frame(sceneWith([]));
    expect(overlay.markers.children).toHaveLength(0);
  });
});

describe('a marker as a click target', () => {
  it('carries the entity id the picker walks up to find', () => {
    const light = createLightEntity('spot');
    const { overlay } = mount(sceneWith([light]));
    const marker = overlay.markers.children[0];

    expect(marker).toBeDefined();
    expect(SceneBinder.resolveEntityId(marker ?? null)).toBe(light.entity.id);
  });

  it('sits where the entity is, and scales with the distance to the camera', () => {
    const light = createLightEntity('point');
    light.entity.transform.position = [3, 0, 0];
    const { overlay, camera, frame } = mount(sceneWith([light]));
    const marker = overlay.markers.children[0];
    if (!marker) throw new Error('no marker');

    expect(marker.position.toArray()).toEqual([3, 0, 0]);
    const near = marker.scale.x;

    camera.position.set(0, 0, 100);
    frame();
    expect(marker.scale.x).toBeGreaterThan(near);
  });

  it('goes invisible with its entity, so a hidden light cannot be clicked', () => {
    // Three does not inherit `visible` and its raycaster does not test it, so
    // this flag is the whole of what keeps a hidden entity unclickable — the
    // same rule as in `Picker`.
    const light = createLightEntity('point');
    const scene = sceneWith([light]);
    const { overlay, frame } = mount(scene);
    expect(overlay.markers.children[0]?.visible).toBe(true);

    const hidden: SceneDoc = {
      ...scene,
      entities: {
        ...scene.entities,
        [light.entity.id]: { ...light.entity, visible: false },
      },
    };
    frame(hidden);
    expect(overlay.markers.children[0]?.visible).toBe(false);
  });

  it('goes invisible under a hidden parent too', () => {
    const parent = createEntity('Rig');
    const light = createLightEntity('point');
    light.entity.parent = parent.entity.id;
    parent.entity.children = [light.entity.id];
    parent.entity.visible = false;

    const { overlay } = mount(sceneWith([parent, light]));
    const marker = overlay.markers.children.find(
      (child) => SceneBinder.resolveEntityId(child) === light.entity.id,
    );

    expect(marker?.visible).toBe(false);
  });

  it('hides everything when the Gizmos toggle is off', () => {
    const scene = sceneWith([createLightEntity('point')]);
    const { overlay, camera } = mount(scene);

    overlay.update(scene, [], camera, CAMERA_HEIGHT, false);
    // The group, not each marker: `Picker` walks the hierarchy, so hiding the
    // root is enough to make the whole overlay unclickable.
    expect(overlay.markers.visible).toBe(false);
    expect(overlay.annotations.visible).toBe(false);
  });
});

describe('the marker as the selection mark', () => {
  it('takes a different material while selected, and gives it back', () => {
    // The only thing that says "selected" for an entity with no extent, now that
    // `SelectionOutline` draws no box around one.
    const light = createLightEntity('point');
    const scene = sceneWith([light]);
    const { overlay, frame } = mount(scene);
    const marker = overlay.markers.children[0];
    if (!(marker instanceof Mesh)) throw new Error('no marker');
    const idle = marker.material;

    frame(scene, [light.entity.id]);
    expect(marker.material).not.toBe(idle);

    frame(scene, []);
    expect(marker.material).toBe(idle);
  });

  it('shares one material across every selected marker', () => {
    // One material per state rather than per marker: tinting each would mean a
    // material and a uniform upload each, for two colours.
    const a = createLightEntity('point');
    const b = createCameraEntity();
    const scene = sceneWith([a, b]);
    const { overlay, frame } = mount(scene);

    frame(scene, [a.entity.id, b.entity.id]);
    const [first, second] = overlay.markers.children;
    if (!(first instanceof Mesh) || !(second instanceof Mesh)) throw new Error('no markers');

    expect(first.material).toBe(second.material);
  });
});

const annotations = (overlay: ViewportOverlay): readonly Object3D[] =>
  overlay.annotations.children;

describe('helpers on the selection', () => {
  it('shows a camera its frustum, and only while it is selected', () => {
    const camera = createCameraEntity();
    const scene = sceneWith([camera]);
    const { overlay, frame } = mount(scene);
    expect(annotations(overlay)).toHaveLength(0);

    frame(scene, [camera.entity.id]);
    expect(annotations(overlay)[0]).toBeInstanceOf(CameraHelper);

    frame(scene, []);
    expect(annotations(overlay)).toHaveLength(0);
  });

  it('shows a directional light its plane and its direction', () => {
    const light = createLightEntity('directional');
    const scene = sceneWith([light]);
    const { overlay, frame } = mount(scene);

    frame(scene, [light.entity.id]);
    expect(annotations(overlay)[0]).toBeInstanceOf(DirectionalLightHelper);
  });

  it('shows an ambient light nothing but its marker', () => {
    // The one kind with nothing to draw, and the only one for which that is not
    // a shortfall: it has no position, no direction and no extent, so a shape
    // could only repeat what the marker already says.
    const light = createLightEntity('ambient');
    const scene = sceneWith([light]);
    const { overlay, frame } = mount(scene);

    frame(scene, [light.entity.id]);
    expect(annotations(overlay)).toHaveLength(0);
    expect(overlay.markers.children).toHaveLength(1);
  });

  it('shows a hemisphere light the two colours it blends', () => {
    const light = createLightEntity('hemisphere');
    const scene = sceneWith([light]);
    const { overlay, frame } = mount(scene);

    frame(scene, [light.entity.id]);
    expect(annotations(overlay)[0]).toBeInstanceOf(HemisphereLightHelper);
  });

  it('shows an area light the rectangle it emits from', () => {
    /*
     * The one helper here that is not an annotation of the light so much as the
     * light itself: `width` and `height` have no other visible consequence
     * until something is lit, so the outline is what they are edited against.
     */
    const light = createLightEntity('rectArea');
    const scene = sceneWith([light]);
    const { overlay, frame } = mount(scene);

    frame(scene, [light.entity.id]);
    expect(annotations(overlay)[0]).toBeInstanceOf(RectAreaLightHelper);
  });

  it('shows a projector the same cone as a spot, being one', () => {
    const light = createLightEntity('projector');
    const scene = sceneWith([light]);
    const { overlay, frame } = mount(scene);

    frame(scene, [light.entity.id]);
    expect(annotations(overlay)[0]).toBeInstanceOf(SpotLightHelper);
  });

  it('draws a point light to its range, and keeps it finite when unbounded', () => {
    /*
     * Not `PointLightHelper`, which is a fixed sphere sized by a constructor
     * argument and never again — it says only what the marker says, and says it
     * at the wrong size the moment the range is edited. three's own source has
     * the version that means something, a sphere of the light's range,
     * commented out.
     *
     * `distance: 0` is what `createLight` gives every new point light and means
     * "no falloff limit", so the fallback below is the common case rather than
     * the edge one.
     */
    const light = createLightEntity('point');
    const scene = sceneWith([light]);
    const { overlay, frame } = mount(scene);

    frame(scene, [light.entity.id]);
    const unbounded = annotations(overlay)[0];
    expect(unbounded).toBeDefined();
    expect(scaleOf(unbounded).x).toBeLessThan(50);

    const held = findComponent(scene, light.entity.id, 'light');
    if (!held) throw new Error('no light component');
    putComponent(scene, light.entity.id, { ...held, distance: 12 });

    frame(scene, [light.entity.id]);
    expect(scaleOf(annotations(overlay)[0]).x).toBeCloseTo(12);
  });

  it('rebuilds when the system rebuilds under it', () => {
    /*
     * A light of a different `kind` is a different class, so `LightSystem`
     * answers `'remount'` and hands back a new object. Nothing tells the overlay;
     * it notices because the object it annotated is no longer the one mounted.
     * Left uncaught, the cone would keep tracking a light nothing draws.
     */
    const light = createLightEntity('spot');
    const scene = sceneWith([light]);
    const { overlay, frame } = mount(scene);
    frame(scene, [light.entity.id]);
    expect(annotations(overlay)[0]).toBeInstanceOf(SpotLightHelper);

    const held = findComponent(scene, light.entity.id, 'light');
    if (!held) throw new Error('no light component');
    putComponent(scene, light.entity.id, { ...held, kind: 'directional' });

    frame(scene, [light.entity.id]);
    expect(annotations(overlay)).toHaveLength(1);
    expect(annotations(overlay)[0]).toBeInstanceOf(DirectionalLightHelper);
  });

  it('keeps a spot cone finite when its range is unbounded', () => {
    /*
     * `distance: 0` means "no falloff limit" and is what `createLight` gives
     * every new spot — so this is the common case, not the edge one.
     * `SpotLightHelper.update` answers it with a cone of a thousand units, which
     * is not so much wrong as unusable: the cone exists to show the angle, and
     * an angle is read near the apex.
     */
    const light = createLightEntity('spot');
    const scene = sceneWith([light]);
    const { overlay, frame } = mount(scene);

    frame(scene, [light.entity.id]);
    const helper = annotations(overlay)[0];
    if (!(helper instanceof SpotLightHelper)) throw new Error('no cone');
    expect(helper.cone.scale.z).toBeLessThan(50);
  });

  it('draws a bounded spot to its actual range', () => {
    const light = createLightEntity('spot');
    const scene = sceneWith([light]);
    const { overlay, frame } = mount(scene);

    const held = findComponent(scene, light.entity.id, 'light');
    if (!held) throw new Error('no light component');
    putComponent(scene, light.entity.id, { ...held, distance: 20 });

    frame(scene, [light.entity.id]);
    const helper = annotations(overlay)[0];
    if (!(helper instanceof SpotLightHelper)) throw new Error('no cone');
    expect(helper.cone.scale.z).toBe(20);
  });

  it('never lets an annotation take a click', () => {
    const camera = createCameraEntity();
    // Lines are picked within a whole unit of them, so this ray, down the
    // middle of a 1 m box, would land on its outline's edges.
    const box = colliderEntity(createColliderShape('box'));
    const scene = sceneWith([camera, box]);
    const { overlay, frame } = mount(scene);
    frame(scene, [camera.entity.id, box.entity.id]);
    expect(annotations(overlay)).toHaveLength(2);

    // Asked of every object in the subtree, not of the group: three's helpers
    // hang their lines off children, and `Raycaster` walks to each of them.
    const raycaster = new Raycaster(new Vector3(0, 0, 10), new Vector3(0, 0, -1));
    const hits: Intersection[] = [];
    for (const object of annotations(overlay)) {
      object.traverse((child) => {
        child.raycast(raycaster, hits);
      });
    }
    expect(hits).toHaveLength(0);
  });
});

describe('what a positional sound covers', () => {
  const audio = (edit: (component: AudioSourceComponent) => void = () => {}): EntityTemplate => {
    const template = createAudioSourceEntity('clip');
    const component = template.components[0] as AudioSourceComponent;
    edit(component);
    return template;
  };

  it('draws nothing for a flat sound, whose marker already says everything', () => {
    // The same answer an ambient light gets, and for the same reason: a 2D
    // source has neither a distance nor a direction to show.
    const source = audio((component) => {
      component.spatialBlend = 0;
    });
    const scene = sceneWith([source]);
    const { overlay, frame } = mount(scene);

    frame(scene, [source.entity.id]);
    expect(annotations(overlay)).toHaveLength(0);
  });

  it('anchors on the entity container, since the component builds no object', () => {
    // The whole reason `SceneBinder.containerFor` exists. Before it,
    // `objectsFor` answered empty for an audio source and the gizmo could never
    // mount at all.
    const source = audio();
    const scene = sceneWith([source]);
    const { overlay, frame } = mount(scene);

    frame(scene, [source.entity.id]);
    expect(annotations(overlay)).toHaveLength(1);
  });

  it('goes away when the source is dialled back to 2D while it is selected', () => {
    // `mount` already refuses a flat source, but that only settles the sound
    // that was *already* flat when it was selected. Dragging 2D ↔ 3D down to
    // zero changes nothing the helper table keys on — the anchor is the entity
    // container, whose identity never moves — so the gizmo is only ever asked to
    // update, and it has to answer this itself.
    const source = audio();
    const scene = sceneWith([source]);
    const { overlay, frame } = mount(scene);

    frame(scene, [source.entity.id]);
    expect(annotations(overlay)[0]?.visible).toBe(true);

    (source.components[0] as AudioSourceComponent).spatialBlend = 0;
    frame(sceneWith([source]), [source.entity.id]);
    expect(annotations(overlay)[0]?.visible).toBe(false);
  });

  it('sizes the two spheres from the document, not from an audio graph', () => {
    const source = audio((component) => {
      component.refDistance = 3;
      component.maxDistance = 25;
    });
    const scene = sceneWith([source]);
    const { overlay, frame } = mount(scene);

    frame(scene, [source.entity.id]);
    const radii = spheresOf(annotations(overlay)[0]);
    expect(radii).toEqual([3, 25]);
  });

  it('ignores the entity`s scale, because Web Audio distances are world units', () => {
    // An entity scaled by ten does not make its sound carry ten times further.
    // A gizmo that grew with the scale would be a confident lie.
    const source = audio((component) => {
      component.refDistance = 2;
      component.maxDistance = 10;
    });
    source.entity.transform.scale = [10, 10, 10];
    const scene = sceneWith([source]);
    const { overlay, frame } = mount(scene);

    frame(scene, [source.entity.id]);
    expect(spheresOf(annotations(overlay)[0])).toEqual([2, 10]);
  });

  it('draws a cone only once the source has stopped being omnidirectional', () => {
    const source = audio();
    const scene = sceneWith([source]);
    const { overlay, frame } = mount(scene);

    frame(scene, [source.entity.id]);
    expect(conesOf(annotations(overlay)[0])).toEqual([false, false]);

    const held = findComponent(scene, source.entity.id, 'audioSource');
    if (held) {
      held.coneInnerAngle = 40;
      held.coneOuterAngle = 90;
    }
    frame(scene, [source.entity.id]);
    expect(conesOf(annotations(overlay)[0])).toEqual([true, true]);
  });

  it('opens the cone down −Z, the direction the runtime reads off the same matrix', () => {
    // A screenshot cannot settle this — a cone drawn down +Z looks much the same
    // from a perspective camera — and getting it wrong would put every
    // directional sound's audible lobe behind the object it belongs to.
    const source = audio((component) => {
      component.refDistance = 2;
      component.maxDistance = 6;
      component.coneInnerAngle = 90;
    });
    const scene = sceneWith([source]);
    const { overlay, frame } = mount(scene);

    frame(scene, [source.entity.id]);
    const cone = (annotations(overlay)[0]?.children ?? []).find(
      (child): child is LineSegments => child instanceof LineSegments && child.visible,
    );
    const points = cone?.geometry.getAttribute('position');
    expect(points).toBeDefined();

    // The mouth sits a whole reach away, on the negative side.
    const reach = Math.min(2 * 3, 6);
    expect(points?.getZ(0)).toBeCloseTo(-reach, 5);
    // …and at a 90° cone the mouth's radius equals its reach.
    expect(Math.hypot(points?.getX(0) ?? 0, points?.getY(0) ?? 0)).toBeCloseTo(reach, 5);
  });
});

/** The uniform scale of each sphere the gizmo drew, near first. */
function spheresOf(root: Object3D | undefined): number[] {
  return (root?.children ?? [])
    .filter((child): child is Mesh => child instanceof Mesh)
    .map((mesh) => mesh.scale.x);
}

/** Whether each cone outline is being drawn, inner first. */
function conesOf(root: Object3D | undefined): boolean[] {
  return (root?.children ?? [])
    .filter((child): child is LineSegments => child instanceof LineSegments)
    .map((lines) => lines.visible);
}

/** An entity carrying one collider of this shape. */
function colliderEntity(shape: ColliderShape, components: ComponentDoc[] = []): EntityTemplate {
  return createEntity('Collider', [{ ...createComponent('collider'), shape }, ...components]);
}

/** The position attribute of a collider's outline. */
function positionsOf(object: Object3D | undefined): BufferAttribute {
  if (!(object instanceof LineSegments)) throw new Error('no outline');
  const positions = object.geometry.getAttribute('position');
  if (!(positions instanceof BufferAttribute)) throw new Error('no positions');
  return positions;
}

/**
 * Where an outline's points are drawn. Through `matrix`: the annotation group
 * sits at the world's origin, and an outline is placed by hand.
 */
function worldPoints(object: Object3D | undefined): Vector3[] {
  const positions = positionsOf(object);
  const matrix = object?.matrix ?? new Matrix4();
  return Array.from({ length: positions.count }, (_, i) =>
    new Vector3().fromBufferAttribute(positions, i).applyMatrix4(matrix),
  );
}

/** How far a built primitive's outside reaches along each of its own axes, from its middle. */
function reachOf(shape: BuiltShape): [number, number, number] {
  switch (shape.kind) {
    case 'box': {
      const [x, y, z] = shape.halfExtents;
      return [x + shape.rounding, y + shape.rounding, z + shape.rounding];
    }
    case 'sphere':
      return [shape.radius, shape.radius, shape.radius];
    case 'capsule':
      return [shape.radius, shape.halfHeight + shape.radius, shape.radius];
    case 'cylinder':
    case 'cone': {
      const across = shape.radius + shape.rounding;
      return [across, shape.halfHeight + shape.rounding, across];
    }
    case 'mesh':
      throw new Error('a mesh reaches as far as its vertices');
  }
}

/** Within a millionth of a metre, axis by axis. */
function expectAt(actual: Vector3, expected: readonly number[]): void {
  actual.toArray().forEach((value, axis) => {
    expect(Math.abs(value - (expected[axis] ?? Number.NaN))).toBeLessThan(1e-6);
  });
}

describe('what a collider is built as', () => {
  /*
   * Each expectation is read from `colliderGeometry`, which the runtime builds
   * from: these hold the outline against what physics builds, rather than
   * stating its rules a second time.
   */

  it('draws each kind where physics builds it, on a scaled entity', () => {
    const kinds = ['box', 'sphere', 'capsule', 'cylinder', 'cone'] as const;
    for (const kind of kinds) {
      for (const rounding of [0, 0.1]) {
        const shape = { ...createColliderShape(kind), center: [0, 0.5, 0] satisfies Vec3 };
        const rounded = 'rounding' in shape ? { ...shape, rounding } : shape;
        const entity = colliderEntity(rounded);
        entity.entity.transform.position = [1, 2, 3];
        entity.entity.transform.scale = [1.5, 1, 1.5];
        const scene = sceneWith([entity]);
        const { overlay, frame } = mount(scene);

        frame(scene, [entity.entity.id]);

        const built = colliderGeometry(rounded, [1.5, 1, 1.5], undefined);
        const middle = new Vector3(...built.position).add(new Vector3(1, 2, 3));
        const reach = new Vector3(...reachOf(built.shape));
        const drawn = new Box3().setFromPoints(worldPoints(annotations(overlay)[0]));
        expectAt(drawn.min, middle.clone().sub(reach).toArray());
        expectAt(drawn.max, middle.clone().add(reach).toArray());
      }
    }
  });

  it('turns with its rotation', () => {
    const capsule = colliderEntity({ ...createColliderShape('capsule'), rotation: [0, 0, Math.PI / 2] });
    const scene = sceneWith([capsule]);
    const { overlay, frame } = mount(scene);

    frame(scene, [capsule.entity.id]);

    const { shape } = colliderGeometry(findColliderShape(scene, capsule), [1, 1, 1], undefined);
    if (shape.kind !== 'capsule') throw new Error('not built as a capsule');
    const drawn = new Box3().setFromPoints(worldPoints(annotations(overlay)[0]));
    const along = shape.halfHeight + shape.radius;
    expectAt(drawn.min, [-along, -shape.radius, -shape.radius]);
    expectAt(drawn.max, [along, shape.radius, shape.radius]);
  });

  it('reads its entity’s pose as physics does, under a shear', () => {
    // Turned inside a parent scaled unevenly, the entity's world matrix is
    // sheared, and three decomposes it into a rotation 0.933 long. Its top
    // alone cannot tell: composed with that rotation, a box keeps its height
    // and is squeezed across, 4.81 m from its middle where physics builds it
    // 5.00 m out.
    const stretched = createEntity('Stretched');
    stretched.entity.transform.scale = [10, 1, 1];
    const turned = colliderEntity({ ...createColliderShape('box'), center: [0, 2, 0] });
    turned.entity.transform.rotation = [0, Math.PI / 4, 0];
    nest(stretched, turned);
    const scene = sceneWith([stretched, turned]);
    const { overlay, binder, frame } = mount(scene);

    frame(scene, [turned.entity.id]);

    const container = binder.containerFor(turned.entity.id);
    if (!container) throw new Error('no container');
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    worldPose(container, position, rotation, scale);
    const built = colliderGeometry(findColliderShape(scene, turned), scale.toArray(), undefined);
    if (built.shape.kind !== 'box') throw new Error('not built as a box');
    const [hx, hy, hz] = built.shape.halfExtents;
    const corners = [-1, 1].flatMap((x) =>
      [-1, 1].flatMap((y) =>
        [-1, 1].map((z) =>
          new Vector3(x * hx, y * hy, z * hz)
            .add(new Vector3(...built.position))
            .applyQuaternion(rotation)
            .add(position),
        ),
      ),
    );
    const expected = new Box3().setFromPoints(corners);
    const drawn = new Box3().setFromPoints(worldPoints(annotations(overlay)[0]));
    expectAt(drawn.min, expected.min.toArray());
    expectAt(drawn.max, expected.max.toArray());
    // Where a ball dropped on it rests, 0.5 m higher.
    expect(Math.abs(drawn.max.y - 2.5)).toBeLessThan(1e-6);
  });

  it('draws a child’s collider at its own entity’s pose', () => {
    const parent = createEntity('Parent', [createComponent('rigidbody')]);
    parent.entity.transform.position = [0, 3, 0];
    parent.entity.transform.rotation = [0, 0, Math.PI / 2];
    parent.entity.transform.scale = [2, 2, 2];
    const child = colliderEntity({ ...createColliderShape('box'), center: [0.5, 0, 0] });
    child.entity.transform.position = [-1, 0, 0];
    nest(parent, child);
    const scene = sceneWith([parent, child]);
    const { overlay, frame } = mount(scene);

    frame(scene, [child.entity.id]);

    // Turned and scaled with its parent, the child sits 2 m below it, and its
    // box, 2 m across, 1 m above the child.
    const drawn = new Box3().setFromPoints(worldPoints(annotations(overlay)[0]));
    expectAt(drawn.min, [-1, 1, -1]);
    expectAt(drawn.max, [1, 3, 1]);
  });

  it('rounds what it is told to, and stays the size drawn', () => {
    const box = colliderEntity({ ...createColliderShape('box'), rounding: 0.1 });
    const scene = sceneWith([box]);
    const { overlay, frame } = mount(scene);

    frame(scene, [box.entity.id]);

    const points = worldPoints(annotations(overlay)[0]);
    const drawn = new Box3().setFromPoints(points);
    expectAt(drawn.min, [-0.5, -0.5, -0.5]);
    expectAt(drawn.max, [0.5, 0.5, 0.5]);
    const corner = new Vector3(0.5, 0.5, 0.5);
    expect(Math.min(...points.map((point) => point.distanceTo(corner)))).toBeGreaterThan(0.05);
  });

  it('follows an edit while selected, and writes nothing when nothing changed', () => {
    const box = colliderEntity(createColliderShape('box'));
    const scene = sceneWith([box]);
    const { overlay, frame } = mount(scene);
    frame(scene, [box.entity.id]);

    const collider = findComponent(scene, box.entity.id, 'collider');
    if (!collider) throw new Error('no collider');
    putComponent(scene, box.entity.id, {
      ...collider,
      shape: { ...createColliderShape('box'), size: [2, 1, 4] },
    });
    frame(scene, [box.entity.id]);

    const drawn = new Box3().setFromPoints(worldPoints(annotations(overlay)[0]));
    expectAt(drawn.max, [1, 0.5, 2]);

    const { version } = positionsOf(annotations(overlay)[0]);
    frame(scene, [box.entity.id]);
    frame(scene, [box.entity.id]);
    expect(positionsOf(annotations(overlay)[0]).version).toBe(version);
  });
});

describe('what a mesh collider is built as', () => {
  /*
   * A Torus at its defaults, radius R and tube t, lying across its own z: its
   * hole is what tells its triangles from its hull. Distances are measured from
   * that axis.
   */
  const R = 0.4;
  const t = 0.15;

  const torus = (build: MeshBuild, ...components: ComponentDoc[]): EntityTemplate => {
    const template = createMeshEntity('torus');
    // At the origin, where its axis is the world's z; a new one stands on the ground.
    template.entity.transform.position = [0, 0, 0];
    template.components.push({ ...createComponent('collider'), shape: { kind: 'mesh', build } }, ...components);
    return template;
  };

  /** Each point's distance from the torus's axis. */
  const fromAxis = (points: readonly Vector3[]): number[] => points.map((point) => Math.hypot(point.x, point.y));

  /** The outline drawn for the one entity selected, which draws something. */
  function drawn(templates: readonly EntityTemplate[], selected: EntityTemplate): Vector3[] {
    const scene = sceneWith(templates);
    const { overlay, frame } = mount(scene);
    frame(scene, [selected.entity.id]);
    const points = worldPoints(annotations(overlay)[0]);
    expect(points.length).toBeGreaterThan(0);
    return points;
  }

  it('draws Triangles as its triangles, hole included', () => {
    const ring = torus('triangles');
    const distances = fromAxis(drawn([ring], ring));

    expect(Math.min(...distances.map((distance) => Math.abs(distance - (R - t))))).toBeLessThan(1e-3);
  });

  it('draws a Convex hull over the hole', () => {
    const ring = torus('hull');
    const distances = fromAxis(drawn([ring], ring));

    expect(Math.min(...distances)).toBeGreaterThan(R - 1e-3);
  });

  it('draws Triangles as the hull a dynamic body makes of them, its own or an ancestor’s', () => {
    const own = torus('triangles', createComponent('rigidbody'));
    expect(Math.min(...fromAxis(drawn([own], own)))).toBeGreaterThan(R - 1e-3);

    const cart = createEntity('Cart', [createComponent('rigidbody')]);
    const ridden = torus('triangles');
    nest(cart, ridden);
    expect(Math.min(...fromAxis(drawn([cart, ridden], ridden)))).toBeGreaterThan(R - 1e-3);
  });

  it('draws Convex parts as its triangles', () => {
    // The parts exist only in the runtime, where V-HACD cuts them.
    const parts = torus('parts');
    const triangles = torus('triangles');

    expect(drawn([parts], parts)).toEqual(drawn([triangles], triangles));
  });

  it('draws a flat mesh’s hull as its triangles, three hulling no flat soup', () => {
    // three hands back a sliver of four of a disc's points, drawn as a triangle.
    const disc = (build: MeshBuild): EntityTemplate => {
      const template = createMeshEntity('circle');
      template.components.push({ ...createComponent('collider'), shape: { kind: 'mesh', build } });
      return template;
    };
    const hull = disc('hull');
    const triangles = disc('triangles');

    expect(drawn([hull], hull)).toEqual(drawn([triangles], triangles));
  });

  it('draws its own entity’s meshes, never its children’s', () => {
    const base = createMeshEntity('box');
    base.entity.transform.position = [0, 0, 0];
    base.components.push({ ...createComponent('collider'), shape: { kind: 'mesh', build: 'hull' } });
    const above = createMeshEntity('box');
    above.entity.transform.position = [0, 3, 0];
    nest(base, above);

    const top = new Box3().setFromPoints(drawn([base, above], base)).max.y;
    expect(Math.abs(top - 0.5)).toBeLessThan(1e-6);
  });

  it('follows its mesh, and a scale moves it without a rebuild', () => {
    const ring = torus('triangles');
    const scene = sceneWith([ring]);
    const { overlay, frame } = mount(scene);
    frame(scene, [ring.entity.id]);

    const mesh = findComponent(scene, ring.entity.id, 'mesh');
    if (mesh?.geometry.kind !== 'torus') throw new Error('no torus');
    putComponent(scene, ring.entity.id, { ...mesh, geometry: { ...mesh.geometry, radius: 0.6 } });
    frame(scene, [ring.entity.id]);
    const outline = annotations(overlay)[0];
    const reach = (): number => new Box3().setFromPoints(worldPoints(annotations(overlay)[0])).max.x;
    expect(Math.abs(reach() - (0.6 + t))).toBeLessThan(1e-3);
    const geometry = outline instanceof LineSegments ? outline.geometry : undefined;

    const entity = scene.entities[ring.entity.id];
    if (!entity) throw new Error('no entity');
    const scaled: SceneDoc = {
      ...scene,
      entities: { ...scene.entities, [entity.id]: { ...entity, transform: { ...entity.transform, scale: [2, 2, 2] } } },
    };
    frame(scaled, [ring.entity.id]);
    expect(Math.abs(reach() - 2 * (0.6 + t))).toBeLessThan(1e-3);
    expect(outline instanceof LineSegments ? outline.geometry : undefined).toBe(geometry);
  });
});

/** The shape of the one collider a template carries, as the scene holds it. */
function findColliderShape(scene: SceneDoc, template: EntityTemplate): ColliderShape {
  const collider = findComponent(scene, template.entity.id, 'collider');
  if (!collider) throw new Error('no collider');
  return collider.shape;
}

describe('teardown', () => {
  it('leaves both groups empty', () => {
    const scene = sceneWith([createLightEntity('spot'), createCameraEntity()]);
    const { overlay, frame } = mount(scene);
    frame(scene, Object.keys(scene.entities));
    expect(overlay.markers.children.length).toBeGreaterThan(0);
    expect(annotations(overlay).length).toBeGreaterThan(0);

    overlay.dispose();

    expect(overlay.markers.children).toHaveLength(0);
    expect(overlay.annotations.children).toHaveLength(0);
  });
});

describe('where a joint holds', () => {
  /** An entity carrying one joint of this motion, at this anchor. */
  const jointEntity = (motion: JointMotion, anchor: Vec3 = [0, 0, 0]): EntityTemplate =>
    createEntity('Joint', [{ ...createJoint(), motion, anchor }]);

  /** The world pose physics reads the entity at. */
  function poseOf(binder: SceneBinder, entityId: string) {
    const container = binder.containerFor(entityId);
    if (!container) throw new Error('no container');
    const position = new Vector3();
    const quaternion = new Quaternion();
    const scale = new Vector3();
    worldPose(container, position, quaternion, scale);
    return { position, quaternion, scale };
  }

  /** Where physics builds the joint: the entity's pose with its anchor and axis on it. */
  function heldAt(binder: SceneBinder, template: EntityTemplate) {
    const joint = template.components[0] as JointComponent;
    const { position, quaternion, scale } = poseOf(binder, template.entity.id);
    const { anchor, axis } = jointFrame(joint, scale.toArray());
    return {
      anchor: new Vector3(...anchor).applyQuaternion(quaternion).add(position),
      axis: new Vector3(...axis).applyQuaternion(quaternion),
      origin: position,
    };
  }

  const average = (points: readonly Vector3[]): Vector3 =>
    points.reduce((sum, point) => sum.add(point), new Vector3()).divideScalar(points.length);

  it('draws its anchor where physics builds it, on a scaled, turned entity', () => {
    // A Fixed joint draws its cross alone, so every point is the cross's.
    const welded = jointEntity(createJointMotion('fixed'), [0.5, 0, 0]);
    welded.entity.transform.position = [1, 2, 3];
    welded.entity.transform.scale = [2, 2, 2];
    welded.entity.transform.rotation = [0, Math.PI / 2, 0];
    const scene = sceneWith([welded]);
    const { overlay, binder, frame } = mount(scene);

    frame(scene, [welded.entity.id]);

    const drawn = average(worldPoints(annotations(overlay)[0]));
    expectAt(drawn, heldAt(binder, welded).anchor.toArray());
    // 1 m out along the entity's x, which the turn points down −z.
    expectAt(drawn, [1, 2, 2]);
  });

  it("draws a hinge's axis, and its limits from where it was built", () => {
    const motion = createJointMotion('hinge');
    const door = jointEntity(
      { ...motion, axis: [0, 1, 0], limits: { enabled: true, min: 0, max: Math.PI / 2 } },
      [-0.5, 0, 0],
    );
    door.entity.transform.position = [2, 1, 0];
    door.entity.transform.rotation = [0, Math.PI / 6, 0];
    const scene = sceneWith([door]);
    const { overlay, binder, frame } = mount(scene);

    frame(scene, [door.entity.id]);

    const { anchor, axis, origin } = heldAt(binder, door);
    const points = worldPoints(annotations(overlay)[0]);
    const from = (point: Vector3) => point.clone().sub(anchor);
    // The axis: 0.5 m each side of the anchor, along it.
    for (const side of [-0.5, 0.5]) {
      const end = anchor.clone().addScaledVector(axis, side);
      expect(Math.min(...points.map((point) => point.distanceTo(end)))).toBeLessThan(1e-6);
    }
    // The needle, from the anchor, towards the door's own origin: its leaf.
    const leaf = from(origin).normalize();
    const tip = anchor.clone().addScaledVector(leaf, 0.5);
    expect(Math.min(...points.map((point) => point.distanceTo(tip)))).toBeLessThan(1e-6);
    // The arc, at 0.5 m in the plane across the axis, from the needle to 90°.
    const across = points.filter(
      (point) => Math.abs(from(point).length() - 0.5) < 1e-6 && Math.abs(from(point).dot(axis)) < 1e-6,
    );
    expect(across.length).toBeGreaterThan(4);
    const sideways = axis.clone().cross(leaf);
    for (const point of across) {
      const angle = Math.atan2(from(point).dot(sideways), from(point).dot(leaf));
      expect(angle).toBeGreaterThan(-1e-6);
      expect(angle).toBeLessThan(Math.PI / 2 + 1e-6);
    }
  });

  it("draws a slider's limits along its axis", () => {
    const motion = createJointMotion('slider');
    const lift = jointEntity({ ...motion, axis: [1, 1, 0], limits: { enabled: true, min: -1, max: 0.5 } });
    lift.entity.transform.position = [0, 3, 0];
    const scene = sceneWith([lift]);
    const { overlay, binder, frame } = mount(scene);

    frame(scene, [lift.entity.id]);

    const { anchor, axis } = heldAt(binder, lift);
    const along = worldPoints(annotations(overlay)[0]).map((point) => point.sub(anchor).dot(axis));
    expect(Math.abs(Math.min(...along) + 1)).toBeLessThan(1e-6);
    expect(Math.abs(Math.max(...along) - 0.5)).toBeLessThan(1e-6);
  });

  it('draws a joint on a child where the child is', () => {
    const parent = createEntity('Door', [createComponent('rigidbody')]);
    parent.entity.transform.position = [0, 3, 0];
    parent.entity.transform.rotation = [0, 0, Math.PI / 2];
    parent.entity.transform.scale = [2, 2, 2];
    const hinge = jointEntity(createJointMotion('fixed'));
    hinge.entity.transform.position = [-1, 0, 0];
    nest(parent, hinge);
    const scene = sceneWith([parent, hinge]);
    const { overlay, frame } = mount(scene);

    frame(scene, [hinge.entity.id]);

    // Turned and scaled with its parent, the child sits 2 m below it.
    expectAt(average(worldPoints(annotations(overlay)[0])), [0, 1, 0]);
  });

  it('follows an edit while selected, and writes nothing when nothing changed', () => {
    const welded = jointEntity(createJointMotion('fixed'));
    const scene = sceneWith([welded]);
    const { overlay, frame } = mount(scene);
    frame(scene, [welded.entity.id]);

    const joint = findComponent(scene, welded.entity.id, 'joint');
    if (!joint) throw new Error('no joint');
    putComponent(scene, welded.entity.id, { ...joint, anchor: [0, 2, 0] });
    frame(scene, [welded.entity.id]);
    expectAt(average(worldPoints(annotations(overlay)[0])), [0, 2, 0]);

    putComponent(scene, welded.entity.id, { ...joint, motion: createJointMotion('hinge') });
    frame(scene, [welded.entity.id]);
    const { version } = positionsOf(annotations(overlay)[0]);
    frame(scene, [welded.entity.id]);
    frame(scene, [welded.entity.id]);
    expect(positionsOf(annotations(overlay)[0]).version).toBe(version);
  });

  it('never lets an annotation take a click', () => {
    const hinge = jointEntity(createJointMotion('hinge'));
    const scene = sceneWith([hinge]);
    const { overlay, frame } = mount(scene);
    frame(scene, [hinge.entity.id]);
    expect(annotations(overlay)).toHaveLength(1);

    // Down the hinge's axis, through its cross and its circle.
    const raycaster = new Raycaster(new Vector3(0, 10, 0), new Vector3(0, -1, 0));
    const hits: Intersection[] = [];
    for (const object of annotations(overlay)) {
      object.traverse((child) => {
        child.raycast(raycaster, hits);
      });
    }
    expect(hits).toHaveLength(0);
  });
});
