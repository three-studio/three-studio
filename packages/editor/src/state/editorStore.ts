import { create } from 'zustand';

/** What the gizmo does with the current selection. Mirrors Unity's Q/W/E/R. */
export type TransformMode = 'select' | 'translate' | 'rotate' | 'scale';
export type TransformSpace = 'world' | 'local';
/** Whether the gizmo sits on the bounds centre or on the object's origin. */
export type PivotMode = 'center' | 'pivot';
export type PlayState = 'stopped' | 'playing' | 'paused';

/**
 * Ephemeral editor state: what is selected, which tool is active, whether the
 * game is running. Nothing here is saved to the project file — that belongs to
 * the scene document.
 */
interface EditorState {
  transformMode: TransformMode;
  transformSpace: TransformSpace;
  pivotMode: PivotMode;
  snapEnabled: boolean;
  /**
   * Markers on entities that draw nothing, and helpers on the selection. Unity's
   * Gizmos toggle, and off for the same reason: icons and cones over a scene
   * make an author unable to judge the lighting they are setting up.
   */
  showGizmos: boolean;
  playState: PlayState;
  stepRequested: boolean;
  selection: readonly string[];

  setTransformMode: (mode: TransformMode) => void;
  toggleTransformSpace: () => void;
  togglePivotMode: () => void;
  toggleSnap: () => void;
  toggleGizmos: () => void;
  setSelection: (ids: readonly string[]) => void;
  clearSelection: () => void;

  play: () => void;
  togglePause: () => void;
  stop: () => void;
  /** Advances one frame while paused. Consumed by the viewport's loop. */
  requestStep: () => void;
  consumeStep: () => boolean;
}

export const useEditorStore = create<EditorState>()((set) => ({
  transformMode: 'translate',
  transformSpace: 'world',
  pivotMode: 'pivot',
  snapEnabled: false,
  showGizmos: true,
  playState: 'stopped',
  stepRequested: false,
  selection: [],

  setTransformMode: (transformMode) => set({ transformMode }),
  toggleTransformSpace: () =>
    set((s) => ({ transformSpace: s.transformSpace === 'world' ? 'local' : 'world' })),
  togglePivotMode: () => set((s) => ({ pivotMode: s.pivotMode === 'center' ? 'pivot' : 'center' })),
  toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled })),
  toggleGizmos: () => set((s) => ({ showGizmos: !s.showGizmos })),
  setSelection: (selection) => set({ selection }),
  clearSelection: () => set({ selection: [] }),

  play: () => set({ playState: 'playing' }),
  togglePause: () =>
    set((s) => ({
      playState: s.playState === 'playing' ? 'paused' : s.playState === 'paused' ? 'playing' : s.playState,
    })),
  stop: () => set({ playState: 'stopped' }),
  requestStep: () => set({ stepRequested: true }),
  consumeStep: () => {
    if (!useEditorStore.getState().stepRequested) return false;
    set({ stepRequested: false });
    return true;
  },
}));
