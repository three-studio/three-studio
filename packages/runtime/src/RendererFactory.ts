import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js';
import {
  ACESFilmicToneMapping,
  PCFSoftShadowMap,
  RectAreaLightNode,
  WebGPURenderer,
} from 'three/webgpu';

export type RendererBackend = 'webgpu' | 'webgl';

let ltcLoaded = false;

/**
 * Hands the renderer the tables a `RectAreaLight` is shaded with.
 *
 * A rect area light is integrated with linearly transformed cosines, and three
 * ships the fitted coefficients as data textures rather than computing them.
 * Without this call an area light is not dim or wrong — it contributes nothing
 * at all, silently, which is the worst way to find out.
 *
 * Here rather than in `LightSystem` because it is a capability of the renderer,
 * not a resource of a light: doing it on first mount would mean a light can
 * exist before the thing that shades it, and the ordering question is exactly
 * the bug class this avoids. Once per process, since the tables are static and
 * `setLTC` writes a class field.
 *
 * The cost is ~300 kB of coefficients in the bundle, paid by every project
 * whether or not it has an area light. Deferring it behind a dynamic import
 * would make it a second chunk that `createRenderer` still always awaits — a
 * round trip, not a saving. Making it conditional means reintroducing the
 * ordering question. If the web player's size ever matters more than that, the
 * lever is a build profile, not this line.
 */
function loadRectAreaTables(): void {
  if (ltcLoaded) return;
  ltcLoaded = true;
  RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init());
}

export interface RendererHandle {
  renderer: WebGPURenderer;
  backend: RendererBackend;
}

/**
 * How many renderers this document currently holds.
 *
 * Two `WebGPURenderer`s drawing inside the same animation frame make **both** of
 * them destroy and rebuild their output render target on every frame: three
 * bumps the target texture's version each tick, `Textures.updateTexture` sees the
 * change and calls `destroyTexture`, and the command buffer already encoded for
 * that frame is submitted against the texture that just went away. It reports as
 * hundreds of `Destroyed texture … used in a submit` per second, on both
 * renderers at once, and it costs a texture allocation per renderer per frame.
 *
 * A page normally has one. The editor grows a second while the import dialog is
 * previewing a model, which is the whole reason this count exists: the viewport
 * consults it and stands down for as long as it is not alone. A *window* each —
 * the launcher — is not affected, since they are separate documents.
 *
 * Counted here because this is the one place a renderer is made. `dispose` is
 * wrapped rather than left to callers, so a renderer that goes away decrements
 * whether or not anyone remembered to say so.
 */
let live = 0;

/** Whether something other than the caller is also rendering into this document. */
export function rendererCount(): number {
  return live;
}

export interface CreateRendererOptions {
  canvas?: HTMLCanvasElement;
  antialias?: boolean;
  /**
   * Escape hatch. `WebGPURenderer` falls back to a WebGL2 backend on its own
   * when WebGPU is unavailable, but forcing it is the fastest way to tell
   * whether a rendering bug belongs to the backend or to our own code.
   */
  forceWebGL?: boolean;
  /**
   * Cap on `devicePixelRatio`. The single cheapest performance knob on a
   * retina display: 1 rather than 2 is a quarter of the pixels.
   */
  maxPixelRatio?: number;
  shadows?: boolean;
  /** `toneMappingExposure`. */
  exposure?: number;
}

/**
 * Single place where a renderer is constructed, for the editor viewport, the
 * play-mode session and the exported web build alike.
 *
 * `renderer.init()` is awaited because acquiring the WebGPU device is async:
 * calling `render()` before it resolves silently draws nothing.
 */
export async function createRenderer({
  canvas,
  antialias = true,
  forceWebGL = false,
  maxPixelRatio = 2,
  shadows = true,
  exposure = 1,
}: CreateRendererOptions = {}): Promise<RendererHandle> {
  const renderer = new WebGPURenderer({ canvas, antialias, forceWebGL });
  await renderer.init();
  loadRectAreaTables();

  live += 1;
  const dispose = renderer.dispose.bind(renderer);
  let disposed = false;
  renderer.dispose = () => {
    // Guarded: `dispose()` is safe to call twice, and a second call must not
    // take the count below the renderers that are actually still drawing.
    if (disposed) return;
    disposed = true;
    live -= 1;
    dispose();
  };

  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, maxPixelRatio));
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = exposure;

  // `Backend` is abstract; only the WebGPU implementation carries this flag.
  const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;

  return { renderer, backend: isWebGPU ? 'webgpu' : 'webgl' };
}
