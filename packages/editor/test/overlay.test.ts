import {
  createAudioSourceEntity,
  createCameraEntity,
  createEntity,
  createLightEntity,
  createMeshComponent,
  createMeshEntity,
  findComponent,
  putComponent,
  type AudioSourceComponent,
  type EntityTemplate,
  type SceneDoc,
} from '@three-studio/core';
import { SceneBinder } from '@three-studio/runtime/SceneBinder';
import { RectAreaLightHelper } from 'three/addons/helpers/RectAreaLightHelper.js';
import {
  CameraHelper,
  DirectionalLightHelper,
  HemisphereLightHelper,
  LineSegments,
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
import { sceneWith } from '../../core/test/fixtures';
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
  const binder = new SceneBinder();
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
     * ADR-13 rules out naming that node as a special case, so the rule has to
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
    // same rule as B7 in `Picker`.
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
    const scene = sceneWith([camera]);
    const { overlay, frame } = mount(scene);
    frame(scene, [camera.entity.id]);

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
