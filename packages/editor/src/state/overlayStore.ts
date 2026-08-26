import { useEffect, useId, useRef } from 'react';
import { create } from 'zustand';

/**
 * What kind of surface is open, for the rules that differ between them.
 *
 * A `modal` owns the whole window until it is answered; a `popover` — a menu, an
 * asset picker — is dismissed by the next click anywhere. Both take the keyboard
 * off the editor, which is why they share a stack rather than having one each.
 */
export type OverlayKind = 'modal' | 'popover';

export interface Overlay {
  id: string;
  kind: OverlayKind;
  /** Called when this surface is the topmost and Escape is pressed. */
  close: () => void;
}

interface OverlayState {
  /** In the order they opened. The last one is the one on top. */
  stack: readonly Overlay[];
  open: (overlay: Overlay) => void;
  close: (id: string) => void;
}

/**
 * Every surface currently covering the editor.
 *
 * The editor's shortcuts are window-level on purpose — Cmd+Z and the tool keys
 * work wherever the cursor is, as they do in Unity and Blender. That is right
 * until something opens on top, and then there was nothing to consult: typing in
 * the import dialog and pressing Cmd+Z undid an edit in the scene behind it,
 * Escape closed the dialog *and* cleared the selection, and Delete removed the
 * entity that happened to be selected.
 *
 * Focus alone cannot answer it. Tweakpane hands focus back to the body once a
 * field is committed, and a button in a dialog was never a text field to begin
 * with — so "is the user typing" and "is this key mine" are different questions.
 * This answers the second one.
 */
export const useOverlayStore = create<OverlayState>()((set) => ({
  stack: [],

  open: (overlay) =>
    set((state) => ({
      // Replacing rather than stacking a second copy: React strict mode mounts
      // twice in development, and an effect that opened without closing would
      // leave a surface behind that nothing can ever pop.
      stack: [...state.stack.filter((open) => open.id !== overlay.id), overlay],
    })),

  close: (id) => set((state) => ({ stack: state.stack.filter((open) => open.id !== id) })),
}));

/** The surface on top, or `null` when the editor has the window to itself. */
export function topOverlay(): Overlay | null {
  const { stack } = useOverlayStore.getState();
  return stack[stack.length - 1] ?? null;
}

/** True while anything covers the editor. */
export function hasOverlay(): boolean {
  return useOverlayStore.getState().stack.length > 0;
}

/**
 * Declares that this component is covering the editor while it is mounted.
 *
 * One line per surface, and the surface no longer has to know anything about
 * shortcuts: it says it is there, and the keyboard layer draws its own
 * conclusions. `onClose` is read through a ref so a caller passing an inline
 * arrow does not re-open the overlay on every render — which would push it back
 * to the top of the stack and steal Escape from whatever opened above it.
 *
 * @param active False while the component is mounted but showing nothing —
 *   `PromptDialog` is always in the tree and renders only when asked. A hook
 *   cannot be called conditionally, so the condition comes in as an argument.
 */
export function useOverlay(kind: OverlayKind, onClose: () => void, active = true): void {
  const id = useId();
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!active) return;
    useOverlayStore.getState().open({ id, kind, close: () => close.current() });
    return () => useOverlayStore.getState().close(id);
  }, [id, kind, active]);
}
