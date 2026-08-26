import type { WebGPURenderer } from 'three/webgpu';

/**
 * Just enough of `Renderer`'s internals to reach the tone-mapping target.
 *
 * `_frameBufferTargets` is private and has no accessor. Reaching into it is
 * exactly as fragile as it looks, which is why the whole thing is one small
 * function with the version it was written against named below.
 */
interface RendererInternals {
  _frameBufferTargets?: Map<unknown, { dispose: () => void }>;
}

/**
 * Throws away three's tone-mapping render target so the next frame builds a new one.
 *
 * **The bug.** `Renderer._getFrameBufferTarget()` keeps one `RenderTarget` per
 * canvas and calls `setSize` on it every frame. When the size changes, three
 * disposes it — destroying the GPU texture — and rebuilds at the new size.
 * Something on the other side keeps a view of the texture that went away, and
 * for the next handful of frames every submit of the scene pass is rejected:
 *
 * ```
 * Destroyed texture [Texture (unlabeled 1904x1202 px, TextureFormat::RGBA16Float)]
 * used in a submit. - While calling [Queue].Submit([[CommandBuffer from
 * CommandEncoder "renderContext_0"]])
 * ```
 *
 * **What it takes to see it**, measured rather than reasoned — the three
 * conditions are all necessary, and none of them is sufficient:
 *
 * | Conditions                                 | Errors / 5 s |
 * | ------------------------------------------ | ------------ |
 * | idle                                       | 0            |
 * | camera translating + resizing              | 0            |
 * | camera turning + resizing, shadows **off** | 0            |
 * | camera turning, no resize, shadows on      | 0            |
 * | camera turning + resizing, shadows on      | 40 – 125     |
 *
 * Turning is what makes the shadow map re-render, and a shadow pass is encoded
 * *inside* the scene pass — the probe reads `open=2`. So the failing submit is
 * always a frame that re-entered `_renderScene` while `renderContext_0` was open,
 * on a target that had been rebuilt a frame or two earlier.
 *
 * **Why this and not something on our side.** Applying the resize from the frame
 * loop instead of the `ResizeObserver` callback was written and measured, and
 * changed the count not at all: 84 and 102 errors against a baseline of 89 to
 * 125. The ordering was never the problem. What does work is not reusing the
 * target: disposing it here means the next `_getFrameBufferTarget()` finds
 * nothing cached and builds a whole new `RenderTarget`, and nothing can be
 * holding a view of a texture that did not exist a frame ago.
 *
 * The cost is one render target allocation per resize — the same allocation the
 * resize was going to force anyway, since `setSize` destroys and rebuilds the
 * texture either way. What is *not* paid is one per frame.
 *
 * Written against three 0.185.1. If a version bump makes `_frameBufferTargets`
 * go away this becomes a no-op rather than a crash, which is the right failure:
 * the errors would come back and be noticed, instead of the editor not starting.
 */
export function retireFrameBufferTarget(renderer: WebGPURenderer): void {
  const targets = (renderer as unknown as RendererInternals)._frameBufferTargets;
  if (!targets) return;

  // Disposed, not merely dropped. Clearing the map alone would leak the GPU
  // texture and its depth buffer on every resize — three frees them from the
  // target's own `dispose`, and nothing else is holding a reference once the map
  // has let go.
  for (const target of targets.values()) target.dispose();
  targets.clear();
}
