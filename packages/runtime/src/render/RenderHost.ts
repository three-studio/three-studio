import type { Disposable } from '@three-studio/core';
import { pass } from 'three/tsl';
import { RenderPipeline, type Camera, type Node, type Object3D, type PassNode, type Scene, type WebGPURenderer } from 'three/webgpu';

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

/** One effect of the post-processing stack: the image so far in, the image after it out; `scene` is the 3D pass. */
export type PostEffect = (image: Node<'vec4'>, scene: PassNode) => Node<'vec4'>;

/** The stack's image: each effect, in order, over the one before it, starting from the 3D pass. */
export function composeStack(effects: readonly PostEffect[], scene: PassNode): Node<'vec4'> {
  return effects.reduce<Node<'vec4'>>((image, effect) => effect(image, scene), scene);
}

/** The stack, built for one scene and one camera. */
interface Stack {
  readonly scene: Scene;
  readonly camera: Camera;
  readonly pass: PassNode;
  readonly pipeline: RenderPipeline;
}

export interface RenderHostOptions {
  readonly renderer: WebGPURenderer;
  /**
   * In order over the 3D pass. None — the editor's views and the player
   * today — and the pass is drawn by `renderer.render` as before: a pipeline
   * adds a full-screen quad to every frame, which a stack with nothing on it
   * would pay for nothing.
   */
  readonly effects?: readonly PostEffect[];
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
  private readonly effects: readonly PostEffect[];
  private overlayScene: Scene | null = null;
  /** Built at the first draw with an effect, and again when the scene or the camera changes. */
  private stack: Stack | null = null;

  constructor(options: RenderHostOptions) {
    this.renderer = options.renderer;
    this.effects = options.effects ?? [];
  }

  /** Drawn over the image through the frame's camera, depth kept: what the editor lays over a running game. */
  get overlay(): Scene | null {
    return this.overlayScene;
  }

  /**
   * Refused while the stack holds an effect: three's `render()` after a
   * pipeline's draws into the frame-buffer target and its own opaque output
   * quad, so the overlay would replace the stack's image rather than land on
   * it. The first host that needs both blends the overlay as a second pass over
   * the stack's output.
   */
  set overlay(scene: Scene | null) {
    if (scene !== null && this.effects.length > 0) {
      throw new Error('A render host with a post effect cannot draw an overlay scene: three would draw it in place of the image.');
    }
    this.overlayScene = scene;
  }

  draw(scene: Scene, camera: Camera): void {
    if (this.effects.length === 0) {
      drawLayers(this.renderer, scene, camera, this.overlayScene);
      return;
    }
    const stack = this.stack !== null && this.stack.scene === scene && this.stack.camera === camera ? this.stack : this.restack(scene, camera);
    stack.pipeline.render();
  }

  dispose(): void {
    this.overlayScene = null;
    this.dropStack();
  }

  /**
   * `outputColorTransform` stays on, so tone mapping and exposure are applied
   * once, in the pipeline's output quad, as `renderer.render` applies them.
   */
  private restack(scene: Scene, camera: Camera): Stack {
    this.dropStack();
    const scenePass = pass(scene, camera);
    const pipeline = new RenderPipeline(this.renderer);
    pipeline.outputNode = composeStack(this.effects, scenePass);
    this.stack = { scene, camera, pass: scenePass, pipeline };
    return this.stack;
  }

  private dropStack(): void {
    this.stack?.pipeline.dispose();
    this.stack?.pass.dispose();
    this.stack = null;
  }
}
