import type { RendererBackend } from '@three-studio/runtime';
import { create } from 'zustand';

interface ViewportStats {
  fps: number;
  drawCalls: number;
  triangles: number;
}

interface ViewportState extends ViewportStats {
  backend: RendererBackend | null;
  /** Non-null when the renderer failed to initialise, so the panel can explain why. */
  error: string | null;
  /** Metres per second of the editor fly camera, surfaced while navigating. */
  flySpeed: number;
  /** Problems the engine found when starting, e.g. a scene with no camera. */
  playWarnings: readonly string[];
  setPlayWarnings: (warnings: readonly string[]) => void;
  /**
   * Whether the Scene view is lighting the scene itself, because the document
   * names no light of its own.
   *
   * Said out loud rather than left to be found out. The pair `EditorViewport`
   * adds is editor-only, so the scene that looks lit here is black in Play and
   * in a build — a difference that is stated is not a divergence, and the same
   * difference discovered is what the complaint was about.
   */
  fallbackLighting: boolean;
  setFallbackLighting: (on: boolean) => void;
  /**
   * Whether time runs in the viewport while nothing is playing.
   *
   * Unreal's **Realtime**, Unity's **Effects ▸ Always Refresh**. Off by default,
   * so a scene sits still while it is being built and a moving surface is never
   * mistaken for a running game — see `viewport/timescale`.
   */
  animated: boolean;
  toggleAnimated: () => void;

  setBackend: (backend: RendererBackend) => void;
  setError: (error: string) => void;
  setStats: (stats: ViewportStats) => void;
  setFlySpeed: (speed: number) => void;
}

/**
 * Kept apart from `editorStore` because these values change every frame. The
 * viewport publishes them on a timer rather than per frame so React re-renders
 * a few times a second instead of sixty.
 */
export const useViewportStore = create<ViewportState>()((set) => ({
  backend: null,
  error: null,
  fps: 0,
  drawCalls: 0,
  triangles: 0,
  flySpeed: 10,
  playWarnings: [],
  fallbackLighting: false,
  animated: false,

  setPlayWarnings: (playWarnings) => set({ playWarnings }),
  setFallbackLighting: (fallbackLighting) => set({ fallbackLighting }),
  setBackend: (backend) => set({ backend }),
  setError: (error) => set({ error }),
  setStats: (stats) => set(stats),
  setFlySpeed: (flySpeed) => set({ flySpeed }),
  toggleAnimated: () => set((state) => ({ animated: !state.animated })),
}));
