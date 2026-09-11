import { createEmptyScene, createMeshEntity } from '@three-studio/core';
import { Box3, Object3D, PerspectiveCamera } from 'three/webgpu';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

/*
 * Whether the transform handles are on screen.
 *
 * One question with two answers is what this is about. `setEnabled` decides
 * whether the handles take the pointer, and the rule the viewport keeps is that
 * handles which cannot be dragged must not be drawn either — a handle that is
 * drawn and does not answer can only be found out by trying to drag it, and by
 * then the camera has moved instead.
 *
 * That rule was written in two places and they disagreed: `setEnabled` hid the
 * handles and `update` showed them again on the very next frame. Both callers
 * that turn them off for a camera gesture had no effect on what was drawn, and
 * Play escaped it only by an accident of ordering. What follows drives the real
 * object through that exact pair of calls.
 *
 * **Why this file can exist when `GizmoController`'s own comment says it
 * cannot.** That comment blames `TransformControls`, and it is out of date:
 * three's `Controls` takes `domElement = null` and only listens when given one.
 * What actually wants a DOM is `RotationReadout`, which asks for a canvas to
 * draw a number on — once, in its constructor, and nowhere on any path this
 * file walks. So the canvas is stood in for, and `getContext` answers `null`,
 * which is a shape the readout already declares and handles.
 */

const canvas = { width: 0, height: 0, getContext: () => null };

beforeAll(() => {
  globalThis.document = { createElement: () => canvas } as unknown as Document;
});

// Imported after the stand-in is in place: the module graph reaches
// `RotationReadout`, whose canvas is taken at construction.
const { GizmoController } = await import('../src/viewport/GizmoController');
const { addEntity } = await import('../src/commands/sceneCommands');
const { useDocumentStore } = await import('../src/state/documentStore');
const { useEditorStore } = await import('../src/state/editorStore');
const { expandedScene } = await import('../src/state/expansion');
const { Selection } = await import('../src/state/selection');

beforeEach(() => {
  useDocumentStore.getState().replaceScene(createEmptyScene());
  useEditorStore.getState().clearSelection();
});

/** A controller on a camera and no element — nothing here presses anything. */
function controller() {
  return new GizmoController(new PerspectiveCamera(), undefined as unknown as HTMLElement);
}

/** One cube in the document, and a selection holding it. */
function selected() {
  const cube = createMeshEntity('box');
  addEntity(cube);
  return Selection.of([cube.entity.id], expandedScene().scene);
}

/** A frame, as the viewport draws one. */
const frame = (gizmo: ReturnType<typeof controller>, selection: ReturnType<typeof selected>) =>
  gizmo.update(selection, () => new Object3D(), new Box3(), 'translate');

describe('whether the handles are drawn', () => {
  it('draws them once there is something to drag', () => {
    const gizmo = controller();
    frame(gizmo, selected());

    expect(gizmo.helper.visible).toBe(true);
  });

  it('keeps them off through a frame drawn after they were switched off', () => {
    /*
     * The regression. Turning them off and then drawing a frame is not an
     * unusual order — it is *the* order: a camera gesture calls `setEnabled`
     * on the press and the viewport goes on drawing every frame after it.
     */
    const gizmo = controller();
    const selection = selected();
    frame(gizmo, selection);

    gizmo.setEnabled(false);
    frame(gizmo, selection);

    expect(gizmo.helper.visible).toBe(false);
  });

  it('brings them back when the gesture ends, without waiting for a frame', () => {
    const gizmo = controller();
    const selection = selected();
    frame(gizmo, selection);
    gizmo.setEnabled(false);

    gizmo.setEnabled(true);

    expect(gizmo.helper.visible).toBe(true);
  });

  it('leaves them off when there is nothing to drag, switched on or not', () => {
    const gizmo = controller();
    frame(gizmo, selected());

    const empty = Selection.of([], expandedScene().scene);
    gizmo.update(empty, () => undefined, null, 'translate');

    expect(gizmo.helper.visible).toBe(false);
    gizmo.setEnabled(true);
    expect(gizmo.helper.visible).toBe(false);
  });
});
