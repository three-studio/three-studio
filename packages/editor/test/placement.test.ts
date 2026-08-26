import {
  createCameraEntity,
  createEmptyScene,
  createEntity,
  createLightEntity,
  createMeshEntity,
} from '@three-studio/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { close } from '../../core/test/fixtures';
import { addEntityInView, placedAt } from '../src/commands/placeEntity';
import { addEntity } from '../src/commands/sceneCommands';
import { worldPosition } from '../src/commands/transformSpace';
import { useDocumentStore } from '../src/state/documentStore';
import { useEditorStore } from '../src/state/editorStore';

/*
 * Where an object added from the menu ends up.
 *
 * There is no canvas under vitest, so `peekViewport()` answers `null` and the
 * placement point stays at the origin. That is the half of the behaviour these
 * tests can reach; the viewport's own half is a three-line call onto
 * `dropPoint`, whose two pieces are covered by `picking.test.ts` and
 * `dropPlane.test.ts`.
 */

const doc = () => useDocumentStore.getState();

beforeEach(() => {
  doc().replaceScene(createEmptyScene());
  useEditorStore.getState().clearSelection();
});

describe('the transform a template needs to land on a point', () => {
  it('reads the default position as an offset from that point', () => {
    const cube = createMeshEntity('box');
    const placed = placedAt(cube.entity.transform, [10, 0, 5]);

    // The 0.5 is the cube resting on the surface, not a place it wanted to be.
    close(placed.position, [10, 0.5, 5]);
  });

  it('keeps the offset a camera describes', () => {
    const camera = createCameraEntity();

    // (0, 2, 8) means "two up and eight back from what I am looking at".
    close(placedAt(camera.entity.transform, [0, 0, -20]).position, [0, 2, -12]);
  });

  it('leaves rotation and scale alone', () => {
    // A plane is flat and a sun light is angled wherever they are put; only the
    // position is a place.
    const plane = createMeshEntity('plane');
    const placed = placedAt(plane.entity.transform, [7, -3, 7]);

    close(placed.rotation, plane.entity.transform.rotation);
    close(placed.scale, [1, 1, 1]);
    close(placed.position, [7, -3, 7]);
  });
});

describe('adding from the menu', () => {
  it('goes to the root', () => {
    const id = addEntityInView(createMeshEntity('box'));

    expect(doc().scene.rootOrder).toContain(id);
    expect(doc().scene.entities[id]?.parent).toBeNull();
    close(worldPosition(doc().scene, id), [0, 0.5, 0]);
  });

  it('goes to the root even with something selected', () => {
    /*
     * Deliberate, and reversed after trying the other way. Unity parents a new
     * object to the selection and it is the most complained-about thing about
     * its Add menu: a hierarchy nobody asked for, from a selection they had
     * forgotten. Unreal and Blender add at the top; nesting stays a gesture of
     * its own — the hierarchy drag, or Cmd+G.
     */
    const selected = addEntity(createEntity('Parent'));
    useEditorStore.getState().setSelection([selected]);

    const id = addEntityInView(createMeshEntity('box'));

    expect(doc().scene.entities[id]?.parent).toBeNull();
    expect(doc().scene.entities[selected]?.children).toEqual([]);
    expect(doc().scene.rootOrder).toContain(id);
  });

  it('leaves an ambient light at the origin', () => {
    const id = addEntityInView(createLightEntity('ambient'));

    expect(doc().scene.entities[id]?.transform.position).toEqual([0, 0, 0]);
  });

  it('stays one undo step, selection included', () => {
    const selected = addEntity(createEntity('Parent'));
    useEditorStore.getState().setSelection([selected]);

    const id = addEntityInView(createMeshEntity('box'));
    expect(useEditorStore.getState().selection).toEqual([id]);

    doc().undo();

    expect(doc().scene.entities[id]).toBeUndefined();
    expect(useEditorStore.getState().selection).toEqual([selected]);
  });
});
