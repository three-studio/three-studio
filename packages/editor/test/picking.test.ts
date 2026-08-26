import {
  createCameraEntity,
  createEntity,
  createLightEntity,
  createMeshEntity,
  type SceneDoc,
} from '@three-studio/core';
import { SceneBinder } from '@three-studio/runtime/SceneBinder';
import { PerspectiveCamera } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { sceneWith } from '../../core/test/fixtures';
import { Picker } from '../src/viewport/Picker';
import { ViewportOverlay } from '../src/viewport/overlay/ViewportOverlay';

/*
 * A click on a light has to select the light.
 *
 * That is the whole of what this feature is for, and it is the one part no
 * screenshot proves: a marker drawn in the right place and unclickable looks
 * exactly like a marker that works.
 */

/** A canvas 800 by 600, since `pick` works in client coordinates. */
const RECT: DOMRect = {
  x: 0,
  y: 0,
  left: 0,
  top: 0,
  right: 800,
  bottom: 600,
  width: 800,
  height: 600,
  toJSON: () => ({}),
};

/** Dead centre of that canvas, which is where the camera is pointed. */
const CENTRE = { x: 400, y: 300 };

function stage(
  scene: SceneDoc,
  pickable: (entityId: string) => boolean = () => true,
): { picker: Picker; overlay: ViewportOverlay; camera: PerspectiveCamera } {
  const binder = new SceneBinder();
  const overlay = new ViewportOverlay(binder);
  const camera = new PerspectiveCamera(60, RECT.width / RECT.height, 0.1, 1000);
  camera.position.set(0, 0, 10);
  camera.updateMatrixWorld(true);

  binder.sync(scene);
  overlay.sync(scene, undefined);
  overlay.update(scene, [], camera, RECT.height, true);

  return { picker: new Picker(binder, pickable, overlay.markers), overlay, camera };
}

describe('picking a marker', () => {
  it('names the light a click landed on', () => {
    const light = createLightEntity('point');
    const { picker, camera } = stage(sceneWith([light]));

    expect(picker.pick(CENTRE.x, CENTRE.y, RECT, camera)).toBe(light.entity.id);
  });

  it('names a camera, which has no geometry either', () => {
    const camera = createCameraEntity();
    const { picker, camera: view } = stage(sceneWith([camera]));

    expect(picker.pick(CENTRE.x, CENTRE.y, RECT, view)).toBe(camera.entity.id);
  });

  it('lets a click through an entity carrying nothing at all', () => {
    // A bare entity earns no marker, so there is nothing at its origin to catch
    // the click — the wall behind it takes it. See `markerStyleFor`.
    const wall = createMeshEntity('box');
    wall.entity.transform.position = [0, 0, 5];
    wall.entity.transform.scale = [10, 10, 0.2];
    const { picker, camera } = stage(sceneWith([wall, createEntity('Rig')]));

    expect(picker.pick(CENTRE.x, CENTRE.y, RECT, camera)).toBe(wall.entity.id);
  });

  it('wins over the geometry behind it', () => {
    /*
     * Priority, not distance. A wall between the camera and a light would
     * otherwise take the click, leaving an icon that plainly says "here I am"
     * and refuses to be selected.
     */
    const wall = createMeshEntity('box');
    wall.entity.transform.position = [0, 0, 5];
    wall.entity.transform.scale = [10, 10, 0.2];
    const light = createLightEntity('point');
    const { picker, camera } = stage(sceneWith([wall, light]));

    expect(picker.pick(CENTRE.x, CENTRE.y, RECT, camera)).toBe(light.entity.id);
  });

  it('is skipped when the entity refuses to be picked', () => {
    // Locked, in the editor. Skipped rather than refused: the click falls
    // through to whatever is behind, which is what `pickable` means everywhere
    // else in this class.
    const wall = createMeshEntity('box');
    wall.entity.transform.position = [0, 0, 5];
    wall.entity.transform.scale = [10, 10, 0.2];
    const light = createLightEntity('point');
    const { picker, camera } = stage(
      sceneWith([wall, light]),
      (id) => id !== light.entity.id,
    );

    expect(picker.pick(CENTRE.x, CENTRE.y, RECT, camera)).toBe(wall.entity.id);
  });

  it('is skipped once the Gizmos toggle hides the overlay', () => {
    const scene = sceneWith([createLightEntity('point')]);
    const { picker, overlay, camera } = stage(scene);
    expect(picker.pick(CENTRE.x, CENTRE.y, RECT, camera)).toBeDefined();

    // Three's raycaster does not test `visible`, so hiding the group is only
    // half the answer — `pick` has to ask, and this is what proves it does.
    overlay.update(scene, [], camera, RECT.height, false);
    expect(picker.pick(CENTRE.x, CENTRE.y, RECT, camera)).toBeUndefined();
  });
});

describe('what the overlay did not change', () => {
  it('still picks a mesh with nothing in front of it', () => {
    const box = createMeshEntity('box');
    const { picker, camera } = stage(sceneWith([box]));

    expect(picker.pick(CENTRE.x, CENTRE.y, RECT, camera)).toBe(box.entity.id);
  });

  it('still answers nothing on empty space', () => {
    const { picker, camera } = stage(sceneWith([createMeshEntity('box')]));

    expect(picker.pick(0, 0, RECT, camera)).toBeUndefined();
  });

  it('keeps markers out of `raycast`, which places dropped models', () => {
    // A marker is an annotation, not a surface: dropping a model onto a light's
    // icon would place it in mid-air for no reason the author could see.
    const { picker, camera } = stage(sceneWith([createLightEntity('point')]));

    expect(picker.raycast(CENTRE.x, CENTRE.y, RECT, camera)).toBeNull();
  });
});
