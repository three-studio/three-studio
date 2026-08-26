import type { EditorViewport } from './EditorViewport';
import { EditorViewport as Viewport } from './EditorViewport';

let pending: Promise<EditorViewport> | null = null;
let current: EditorViewport | null = null;

/**
 * There is exactly one viewport for the lifetime of the editor window.
 *
 * Creation is async (the WebGPU device) and expensive, and the Scene and Game
 * dock panels both want the same canvas, so the instance is memoised here
 * rather than owned by whichever React component happened to mount first.
 */
export function acquireViewport(): Promise<EditorViewport> {
  pending ??= Viewport.create().then((viewport) => {
    current = viewport;
    // Dev-only handle: the scene graph is otherwise unreachable from devtools
    // and from the headless smoke check.
    if (import.meta.env.DEV) {
      (globalThis as unknown as Record<string, unknown>)['__studioViewport'] = viewport;
    }
    return viewport;
  });
  return pending;
}

/** The viewport if it already exists, without forcing its creation. */
export function peekViewport(): EditorViewport | null {
  return current;
}
