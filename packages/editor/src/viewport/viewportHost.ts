import type { EditorRegistries } from '../registries';
import type { EditorViewport } from './EditorViewport';
import { EditorViewport as Viewport } from './EditorViewport';

let pending: Promise<EditorViewport> | null = null;
let current: EditorViewport | null = null;

/**
 * There is exactly one viewport for the lifetime of the editor window.
 *
 * Creation is async (the WebGPU device) and expensive, and more than one part
 * of the editor wants it — the Viewport, the import dialog's preview, the
 * commands that place or frame — so the instance is memoised here rather than
 * owned by whichever React component happened to mount first.
 *
 * Every caller hands over the window's registries, since any of them may be
 * the one that creates it; there is one such object per window, so the first
 * caller's is everyone's.
 */
export function acquireViewport(registries: EditorRegistries): Promise<EditorViewport> {
  pending ??= Viewport.create(registries).then((viewport) => {
    current = viewport;
    return viewport;
  });
  return pending;
}

/** The viewport if it already exists, without forcing its creation. */
export function peekViewport(): EditorViewport | null {
  return current;
}
