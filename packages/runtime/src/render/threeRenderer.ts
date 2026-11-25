import type { WebGPURenderer } from 'three/webgpu';

/*
 * The one place the code reaches into three's renderer for what it has no API
 * for. Each field is private, so it is read as `unknown` and decoded rather than
 * typed: written against three 0.185.1, a version that renames one turns its
 * function into a no-op — the bug it worked around comes back and is noticed —
 * instead of the window not starting.
 */

/** Calls `owner.dispose()`, if `owner` is an object with one. */
function disposeOf(owner: unknown): void {
  if (typeof owner !== 'object' || owner === null) return;
  const dispose: unknown = Reflect.get(owner, 'dispose');
  if (typeof dispose === 'function') Reflect.apply(dispose, owner, []);
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
 */
export function retireFrameBufferTarget(renderer: object): void {
  const targets: unknown = Reflect.get(renderer, '_frameBufferTargets');
  if (!(targets instanceof Map)) return;
  // Disposed, not merely dropped. Clearing the map alone would leak the GPU
  // texture and its depth buffer on every resize — three frees them from the
  // target's own `dispose`, and nothing else is holding a reference once the map
  // has let go.
  for (const target of targets.values()) disposeOf(target);
  targets.clear();
}

/**
 * The one resize rule of every window that draws: `setSize` without touching the
 * canvas's styles (the page lays it out), then a fresh tone-mapping target, for
 * the destroyed-texture errors `retireFrameBufferTarget` describes — a build runs
 * the same renderer the editor does, so it saw them too.
 */
export function resizeRenderer(renderer: WebGPURenderer, width: number, height: number): void {
  renderer.setSize(width, height, false);
  retireFrameBufferTarget(renderer);
}

/**
 * Lets go of every render list `renderer` keeps, which it builds again at its
 * next draw. Called when a scene leaves a world, and by each window's loop when
 * its asset cache freed something.
 *
 * Why: a list keyed by a scene and a camera keeps every object it last drew —
 * three's `finish()` clears only the items past the frame's count — until it is
 * drawn again, and one that never is keeps them for good. A deleted model was
 * 409 MB held by the sun's shadow list: it had been the last lit mesh, so no
 * shadow pass ran again to clear the list, and one shadow draw by hand brought
 * the heap to 26 MB. Forgetting every list is the only API three has.
 *
 * And three 0.185 never drops a bind group from the set a texture keeps of the
 * bind groups that sample it, unless that texture is disposed — and the
 * `DFG_LUT` every PBR material samples never is. Through those bind groups'
 * nodes it keeps the shadow camera of every light ever drawn, and through each
 * camera its render list. A game's one world keeps its `Scene` across every
 * switch, and S6 grew 0.9 MB a switch — 22 MB over thirty — until the lists
 * were let go as each scene left.
 *
 * A renderer not initialised yet has no lists.
 */
export function forgetRenderLists(renderer: object | null | undefined): void {
  if (renderer) disposeOf(Reflect.get(renderer, '_renderLists'));
}
