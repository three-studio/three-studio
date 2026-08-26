import type { AssetSettings, ModelSettings } from '@three-studio/core';
import { createRenderer, loadModelFromUrl } from '@three-studio/runtime';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  Box3,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  LoadingManager,
  MathUtils,
  PerspectiveCamera,
  Scene,
  Vector3,
  type Mesh,
  type Object3D,
  type WebGPURenderer,
} from 'three/webgpu';
import type { ModelFacts } from './facts';
import type { PreviewSurface } from './PreviewSurface';

/** Slightly lighter than the panel, so a dark model still has an edge. */
const BACKDROP = 0x2a2a2a;

/**
 * A model, turned around in a scene of its own.
 *
 * A second renderer, not the viewport's: that one is a single memoised canvas
 * moved between the Scene and Game panels, and it is holding a project. The
 * launcher already runs a second one for the same reason.
 *
 * One per **row**, not one per dialog: `ImportDialog` keys `<Preview>` on the
 * file id, so selecting another file unmounts this and builds a new one — a
 * WebGPU device created and destroyed per file browsed. Sharing one across the
 * dialog would be better and is not what happens today; saying so here rather
 * than describing an intention, because two renderers alive at once on the same
 * page is the condition that made `start()` worth its comment.
 *
 * What it draws is the model *as the settings say it will be imported* — scaled,
 * turned upright, collision hulls dropped. That is the whole argument for a
 * preview: the numbers in the panel say 2746 units, and this says whether that
 * is a tree or a wall.
 */
export class ModelPreview implements PreviewSurface {
  private renderer: WebGPURenderer | null = null;
  private controls: OrbitControls | null = null;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(45, 1, 0.01, 10_000);
  /** The loaded file, untouched. Settings are applied to the pivot above it. */
  private readonly pivot = new Group();
  private model: Object3D | null = null;
  private frame = 0;
  private resize: ResizeObserver | null = null;
  private disposed = false;

  async open(container: HTMLElement, url: string): Promise<ModelFacts | null> {
    const canvas = document.createElement('canvas');
    canvas.className = 'h-full w-full';
    container.append(canvas);

    const { renderer } = await createRenderer({ canvas, shadows: false, maxPixelRatio: 2 });
    if (this.disposed) {
      renderer.dispose();
      return null;
    }
    this.renderer = renderer;
    this.scene.background = new Color(BACKDROP);
    this.scene.add(this.pivot);
    this.buildLights();

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    // No panning: there is one object and it is centred. Panning off it and
    // having no way back is the fastest way to make a preview look broken.
    this.controls.enablePan = false;

    const loaded = await loadModelFromUrl(url, new LoadingManager());
    if (this.disposed) return null;
    this.model = loaded.object;
    this.pivot.add(this.model);

    const facts = measure(this.model, loaded.animations.length);
    this.fit(facts.size);
    this.observe(container, canvas);
    this.start();
    return facts;
  }

  update(settings: AssetSettings): void {
    const object = this.model;
    if (settings.kind !== 'model' || object === null) return;
    const model = settings as ModelSettings;

    this.pivot.scale.setScalar(model.scale);
    // A quarter turn back about X, which is what "the file calls Z up" means
    // once it is in a Y-up scene.
    this.pivot.rotation.x = model.upAxis === 'z' ? -Math.PI / 2 : 0;

    if (model.format === 'fbx') {
      const hide = model.collisionMeshes === 'ignore';
      object.traverse((child) => {
        if (isCollisionHull(child)) child.visible = !hide;
      });
    }
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resize?.disconnect();
    this.controls?.dispose();
    this.model?.traverse((child) => {
      const mesh = child as Partial<Mesh>;
      mesh.geometry?.dispose();
      for (const material of materialsOf(mesh.material)) material.dispose();
    });
    this.renderer?.dispose();
    this.renderer = null;
  }

  private buildLights(): void {
    // Enough to read a shape by, and no more: this is a preview, not a render.
    this.scene.add(new HemisphereLight(0xffffff, 0x333344, 2.2));
    const key = new DirectionalLight(0xffffff, 2.4);
    key.position.set(3, 5, 4);
    this.scene.add(key);
  }

  /**
   * Frames the model whatever size it turns out to be.
   *
   * The bounding box is in the file's own units, so this has to work for a
   * 2746-unit tree and a 0.4-unit bolt alike — which is exactly why the camera
   * is placed from the box rather than from a constant.
   */
  private fit(size: readonly [number, number, number]): void {
    const extent = Math.max(...size) || 1;
    const distance = (extent / 2) / Math.tan(MathUtils.degToRad(this.camera.fov / 2));

    const bounds = new Box3().setFromObject(this.pivot);
    const centre = bounds.getCenter(new Vector3());

    this.camera.near = extent / 1000;
    this.camera.far = extent * 100;
    this.camera.position.set(
      centre.x + distance * 0.9,
      centre.y + extent * 0.35,
      centre.z + distance * 1.2,
    );
    this.camera.updateProjectionMatrix();
    this.controls?.target.copy(centre);
    this.controls?.update();
  }

  private observe(container: HTMLElement, canvas: HTMLCanvasElement): void {
    const apply = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer?.setSize(width, height, false);
    };
    apply();
    this.resize = new ResizeObserver(apply);
    this.resize.observe(container);
    canvas.style.display = 'block';
  }

  /**
   * The frame loop, and the one line in it that matters.
   *
   * `render()` and **not** `renderAsync()`. The two look interchangeable — the
   * async one is `await this.init(); this.render(...)` and nothing else — but the
   * await defers the render past the end of the animation frame callback, and a
   * WebGPU render that submits outside the frame it was started in submits
   * against textures that frame has already invalidated. It cost hundreds of
   * `Destroyed texture ... used in a submit` per second, on *both* renderers on
   * the page: this one and the viewport behind the dialog.
   *
   * `render()` has one precondition, an initialised backend, and `createRenderer`
   * already awaits `renderer.init()`.
   */
  private start(): void {
    const tick = () => {
      // The frame already queued when the dialog closed still runs. Rendering
      // through a renderer that `dispose()` has taken apart is the same fault
      // by a different route.
      if (this.disposed) return;
      this.frame = requestAnimationFrame(tick);
      this.controls?.update();
      this.renderer?.render(this.scene, this.camera);
    };
    tick();
  }
}

/** Unreal writes its collision hulls into the FBX under this prefix. */
function isCollisionHull(object: Object3D): boolean {
  return object.name.toUpperCase().startsWith('UCX_');
}

function measure(model: Object3D, animations: number): ModelFacts {
  let meshes = 0;
  let triangles = 0;
  const materials = new Set<unknown>();

  model.traverse((child) => {
    const mesh = child as Partial<Mesh>;
    if (!mesh.geometry) return;
    meshes += 1;
    const index = mesh.geometry.getIndex();
    const position = mesh.geometry.getAttribute('position');
    triangles += Math.floor((index?.count ?? position?.count ?? 0) / 3);
    for (const material of materialsOf(mesh.material)) materials.add(material);
  });

  const box = new Box3().setFromObject(model);
  const size = box.isEmpty() ? new Vector3() : box.getSize(new Vector3());

  return {
    kind: 'model',
    meshes,
    triangles,
    materials: materials.size,
    animations,
    size: [size.x, size.y, size.z],
  };
}

function materialsOf(material: unknown): { dispose(): void }[] {
  if (Array.isArray(material)) return material as { dispose(): void }[];
  if (material && typeof (material as { dispose?: unknown }).dispose === 'function') {
    return [material as { dispose(): void }];
  }
  return [];
}
