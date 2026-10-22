import type { PerspectiveCamera } from 'three/webgpu';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../src/state/editorStore';
import type { FlyControls } from '../src/viewport/FlyControls';
import type { GizmoController } from '../src/viewport/GizmoController';
import type { Picker } from '../src/viewport/Picker';
import { ViewportInput } from '../src/viewport/ViewportInput';

/*
 * Who gets the edit view's pointer: the camera, the gizmo, or the selection —
 * and, from the press of Play, none of them. The edit image stays on screen
 * while the game starts, and a press on it must neither fly the camera nor drag
 * a handle into an edit the scene lock refuses. The release is
 * heard on the window, so a click anywhere — the toolbar's Pause included —
 * used to give the camera back to a view the game was starting in.
 */

beforeAll(() => {
  // The release is heard on the window; nothing on this path reads it back.
  Object.assign(globalThis, { window: new EventTarget() });
});

afterAll(() => {
  Reflect.deleteProperty(globalThis, 'window');
});

/** A pointer event as the arbitration reads it: the button, where, and Alt. */
function pointer(type: string, init: { button?: number; altKey?: boolean } = {}): Event {
  return Object.assign(new Event(type), { button: 0, clientX: 50, clientY: 50, altKey: false, ...init });
}

const made: ViewportInput[] = [];

/** The arbitration on a canvas of its own, its subjects recording what they are told. */
function arbitration(editorInput: boolean): { calls: string[]; canvas: EventTarget } {
  const calls: string[] = [];
  const canvas = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
  });
  const input = new ViewportInput(canvas as unknown as HTMLCanvasElement, {
    editorInput,
    camera: {} as PerspectiveCamera,
    controls: { setEnabled: (on: boolean) => calls.push(`camera ${on ? 'on' : 'off'}`) } as unknown as FlyControls,
    gizmo: {
      isEngaged: false,
      setEnabled: (on: boolean) => calls.push(`gizmo ${on ? 'on' : 'off'}`),
    } as unknown as GizmoController,
    picker: {
      pick: () => {
        calls.push('pick');
        return 'crate';
      },
    } as unknown as Picker,
  });
  input.installSelection();
  made.push(input);
  return { calls, canvas };
}

beforeEach(() => {
  useEditorStore.getState().setSelection(['wall']);
});

afterEach(() => {
  for (const input of made.splice(0)) input.dispose();
});

describe('the view’s pointer, once Play is pressed', () => {
  it('neither switches the handles off nor touches the camera on a right press', () => {
    const { calls, canvas } = arbitration(false);

    canvas.dispatchEvent(pointer('pointerdown', { button: 2 }));

    expect(calls).toEqual([]);
  });

  it('does not give the camera back at a release anywhere', () => {
    const { calls, canvas } = arbitration(false);

    window.dispatchEvent(pointer('pointerup'));
    window.dispatchEvent(pointer('pointercancel'));
    canvas.dispatchEvent(pointer('lostpointercapture'));

    expect(calls).toEqual([]);
  });

  it('picks nothing on a click, and leaves the selection', () => {
    const { calls, canvas } = arbitration(false);

    canvas.dispatchEvent(pointer('pointerdown'));
    canvas.dispatchEvent(pointer('pointerup'));

    expect(calls).toEqual([]);
    expect(useEditorStore.getState().selection).toEqual(['wall']);
  });
});

describe('the view’s pointer, while the scene is edited', () => {
  it('gives the camera back at a release anywhere', () => {
    const { calls } = arbitration(true);

    window.dispatchEvent(pointer('pointerup'));

    expect(calls).toEqual(['camera on']);
  });

  it('picks and selects on a click', () => {
    const { calls, canvas } = arbitration(true);

    canvas.dispatchEvent(pointer('pointerdown'));
    canvas.dispatchEvent(pointer('pointerup'));

    expect(calls).toEqual(['camera on', 'pick']);
    expect(useEditorStore.getState().selection).toEqual(['crate']);
  });
});
