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
  /**
   * The entity a view has been asked to put into inline edit, or `null`.
   *
   * Here rather than in the panel's own `useState`, and the reason is the whole
   * of T-063. Renaming is the one gesture a command cannot finish: what it does
   * is put a *row* into edit mode, and only the hierarchy has rows. That used to
   * be wired through a mutable module slot in `commands/` — a command registry
   * containing a callback registry — filled by nobody, so `rename.run()` did
   * nothing at all.
   *
   * A field a command writes and a view reads is the same shape `assetStore`
   * already uses for `revealed`, and it is deliberately **not** an event bus: it
   * holds no queue, nothing subscribes to a channel, and a view that is not
   * mounted simply never reads it. What it is, is the answer to "which row is
   * being edited", which is a question about the editor and not about the panel
   * that happens to draw it.
   */
  renaming: string | null;
  /**
   * Whether the command palette is up.
   *
   * A field a command writes and a view reads, the same shape as `renaming`
   * above: opening it is a gesture, and a gesture reached from a key has to go
   * through the registry or it needs a fourth spelling of "which key does what",
   * which is exactly what T-064 removed.
   */
  paletteOpen: boolean;

  setTransformMode: (mode: TransformMode) => void;
  toggleTransformSpace: () => void;
  togglePivotMode: () => void;
  toggleSnap: () => void;
  toggleGizmos: () => void;
  setSelection: (ids: readonly string[]) => void;
  clearSelection: () => void;
  /** Asks whichever view holds this entity to edit its name in place. */
  beginRename: (entityId: string) => void;
  /** Cleared by the view when the field closes, committed or abandoned. */
  endRename: () => void;
  openPalette: () => void;
  closePalette: () => void;

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
  renaming: null,
  paletteOpen: false,

  beginRename: (renaming) => set({ renaming }),
  endRename: () => set({ renaming: null }),
  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),

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
