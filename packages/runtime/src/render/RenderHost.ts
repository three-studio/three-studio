import type { Disposable } from '@three-studio/core';
import type { Camera, Object3D, Scene, WebGPURenderer } from 'three/webgpu';

/** What drawing a frame in layers needs of a renderer: `WebGPURenderer` is one, and a test's recorder too. */
export interface LayerRenderer {
  autoClear: boolean;
  render(scene: Object3D, camera: Camera): unknown;
}

/**
 * One frame, back to front: `scene` through `camera`, then `overlay`, if any,
 * through the same camera onto that image.
 *
 * `render()` and **not** `renderAsync()`. The two look interchangeable — the
 * async one is `await this.init(); this.render(...)` and nothing else — but the
 * await defers the render past the end of the animation frame callback, and a
 * WebGPU render that submits outside the frame it was started in submits
 * against textures that frame has already invalidated. It cost hundreds of
 * `Destroyed texture … used in a submit` per second back when the import
 * preview had a renderer of its own to make the mistake on. `render()` has one
 * precondition, an initialised backend, and `createRenderer` awaits it.
 */
export function drawLayers(renderer: LayerRenderer, scene: Scene, camera: Camera, overlay: Scene | null): void {
  renderer.render(scene, camera);
  if (overlay === null) return;
  // Uncleared, so it lands on the image rather than in place of it: three draws
  // both into its tone-mapping target and copies that out whole.
  const { autoClear } = renderer;
  renderer.autoClear = false;
  try {
    renderer.render(overlay, camera);
  } finally {
    renderer.autoClear = autoClear;
  }
}

export interface RenderHostOptions {
  readonly renderer: WebGPURenderer;
}

/**
 * Draws one view's frames: the editor's edit view, its game and its import
 * preview, the player. One per view on the window's one renderer, because a
 * second `WebGPURenderer` drawing in the same animation frame destroys and
 * rebuilds the first one's output target every frame.
 *
 * A host has no size: the app sizes the renderer (`resizeRenderer`) and, in
 * the editor, sets the view's viewport before the draw.
 */
export class RenderHost implements Disposable {
  readonly renderer: WebGPURenderer;
  /** Drawn over the image through the frame's camera, depth kept: what the editor lays over a running game. */
  overlay: Scene | null = null;

  constructor(options: RenderHostOptions) {
    this.renderer = options.renderer;
  }

  draw(scene: Scene, camera: Camera): void {
    drawLayers(this.renderer, scene, camera, this.overlay);
  }

  dispose(): void {
    this.overlay = null;
  }
}
