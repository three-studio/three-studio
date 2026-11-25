import type { Disposable } from '@three-studio/core';
import type { World } from '../world/World';
import { pass } from 'three/tsl';
import {
  Box3,
  OrthographicCamera,
  RenderPipeline,
  Scene,
  Sphere,
  type Camera,
  type Node,
  type Object3D,
  type PassNode,
  type WebGPURenderer,
} from 'three/webgpu';

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

/** What compiling ahead needs of a renderer: `WebGPURenderer` is one, and a test's recorder too. */
export interface CompileRenderer {
  compileAsync(scene: Object3D, camera: Camera, targetScene?: Scene | null): Promise<void>;
}

/**
 * Builds ahead what drawing `root` — built, hidden — will take: its geometry
 * and textures uploaded, and the programs and GPU pipelines for the shader
 * text it draws with, which is the costly part. A scene built behind the
 * loading scene used to pay them all in its first frame, ~700 ms for S6's.
 *
 * - Against a fresh stage carrying `shown`'s environment and fog and no light:
 *   the lights are the root's own, projected with it, so their key is the one
 *   the scene is drawn with once it is up; the environment and fog stand in
 *   for the target's, and match when they are of the same kind.
 * - Through a fresh orthographic camera framing the root's bounds: three
 *   skips what its camera does not see.
 * - Stage and camera fresh because the compile's render list is keyed by them:
 *   nothing outlives the scene through it.
 * - The root is shown for the call alone: three projects it synchronously, as
 *   the call starts, and a frame drawn while the rest compiles must not draw it.
 *
 * Still built in the start frame: the node graphs for the scene the world
 * draws (three keys them by node id), and the draws of batches formed when the
 * scene starts.
 */
export function compileHidden(renderer: CompileRenderer, root: Object3D, shown: Scene): Promise<void> {
  const stage = new Scene();
  stage.environment = shown.environment;
  stage.fog = shown.fog;
  const bounds = new Box3().setFromObject(root).getBoundingSphere(new Sphere());
  const radius = Math.max(bounds.radius, 1);
  const camera = new OrthographicCamera(-radius, radius, radius, -radius, 0.01, radius * 4);
  camera.position.copy(bounds.center).setZ(bounds.center.z + radius * 2);
  camera.lookAt(bounds.center);
  camera.updateMatrixWorld();
  const visible = root.visible;
  root.visible = true;
  try {
    return renderer.compileAsync(root, camera, stage);
  } finally {
    root.visible = visible;
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
 * Back to front: the 3D pass, the overlay scene, then the shown world's screen
 * layers, stacked over the canvas in one container of the stage. A pointer
 * goes to the frontmost element under it that takes pointers — a layer's
 * interactive part — and otherwise to the canvas, where the game's `Input`
 * listens: the stacking order is the routing order, with no capture and no
 * `stopPropagation`, since no layer is an ancestor of the canvas.
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
  private stage: HTMLElement | null = null;
  private shown: World | null = null;
  /** Holds the shown world's layers, after the canvas in the stage; made when a world is first shown. */
  private layers: HTMLElement | null = null;

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

  /** Where screen layers stack: the element holding this view's canvas. */
  setStage(stage: HTMLElement | null): void {
    if (stage === this.stage) return;
    this.stage = stage;
    this.layers?.remove();
    if (stage !== null && this.layers !== null) stage.appendChild(this.layers);
  }

  /** Lays `world`'s screen layers over the canvas, and follows them as they change; `null` takes them off. */
  show(world: World | null): void {
    if (this.shown !== null) this.shown.screen.onChange = null;
    this.shown = world;
    if (world !== null) world.screen.onChange = () => this.restackLayers();
    this.restackLayers();
  }

  /** Builds ahead what drawing a built, hidden scene root takes, against the shown world (`compileHidden`). */
  async compile(root: Object3D): Promise<void> {
    if (this.shown !== null) await compileHidden(this.renderer, root, this.shown.scene);
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
    this.show(null);
    this.layers?.remove();
    this.layers = null;
    this.stage = null;
  }

  /**
   * At events only: a world shown or taken off, a layer added or gone. The
   * container's z-index is the one the sticks had, under the device page's
   * stats at 20.
   */
  private restackLayers(): void {
    const all = this.shown?.screen.all ?? [];
    if (this.layers === null) {
      if (all.length === 0) return;
      this.layers = document.createElement('div');
      Object.assign(this.layers.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '10' });
      this.stage?.appendChild(this.layers);
    }
    for (const layer of all) Object.assign(layer.element.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    this.layers.replaceChildren(...all.map((layer) => layer.element));
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
