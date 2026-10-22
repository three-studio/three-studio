import type { RendererBackend } from '@three-studio/runtime';
import { create } from 'zustand';

interface ViewportStats {
  fps: number;
  drawCalls: number;
  triangles: number;
}

interface ViewportState extends ViewportStats {
  backend: RendererBackend | null;
  /**
   * Non-null when the renderer failed to start, so the Viewport can explain why.
   *
   * The one failure that takes the whole view, because without a renderer there
   * is no view to keep. Written by the Viewport's own start and by nothing else:
   * a Play that threw used to write here too, and the Viewport became "The
   * renderer failed to start." for good — over a renderer that worked, for a
   * game that would have started at the next press. A failed Play is said in a
   * toast now, and the edit view stays.
   */
  rendererError: string | null;
  /** Metres per second of the editor fly camera, surfaced while navigating. */
  flySpeed: number;
  /**
   * The running scene's set-up problems, e.g. a scene with no camera: published
   * anew each time a scene starts running — a script's change of scene
   * included — and empty while stopped. Nothing else goes here: a Play that
   * fails to start never runs a scene, and says so in a toast.
   */
  playWarnings: readonly string[];
  setPlayWarnings: (warnings: readonly string[]) => void;
  /**
   * Whether the edit view is lighting the scene itself, because the document
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
  setRendererError: (error: string) => void;
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
  rendererError: null,
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
  setRendererError: (rendererError) => set({ rendererError }),
  setStats: (stats) => set(stats),
  setFlySpeed: (flySpeed) => set({ flySpeed }),
  toggleAnimated: () => set((state) => ({ animated: !state.animated })),
}));
