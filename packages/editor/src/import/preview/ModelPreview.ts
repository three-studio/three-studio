import type { AssetSettings, ModelSettings } from '@three-studio/core';
import { loadModelFromUrl } from '@three-studio/runtime';
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
} from 'three/webgpu';
import type { EditorViewport } from '../../viewport/EditorViewport';
import { acquireViewport } from '../../viewport/viewportHost';
import type { ModelFacts } from './facts';
import type { PreviewSurface } from './PreviewSurface';

/** Slightly lighter than the panel, so a dark model still has an edge. */
const BACKDROP = 0x2a2a2a;

/**
 * A model, turned around in a scene of its own.
 *
 * A third view of the editor's one renderer, and not a renderer of its own. It
 * used to be a second one, and two `WebGPURenderer`s drawing inside a single
 * animation frame destroy and rebuild each other's output target every frame —
 * so the viewport counted the renderers on the page and stood down for as long
 * as this was open, which on screen read as the viewport freezing the moment the
 * import dialog appeared. See `EditorViewport.attachPreview`.
 *
 * One per **row**, not one per dialog: `ImportDialog` keys `<Preview>` on the
 * file id, so selecting another file unmounts this and builds a new one. That
 * used to be a WebGPU device created and destroyed per file browsed; it is now a
 * `Scene`, a camera and an `OrbitControls`, which is cheap enough that a
 * strategy per row stays the right shape.
 *
 * What it draws is the model *as the settings say it will be imported* — scaled,
 * turned upright, collision hulls dropped. That is the whole argument for a
 * preview: the numbers in the panel say 2746 units, and this says whether that
 * is a tree or a wall.
 *
 * It draws through the project's renderer, so its shadows, tone mapping and
 * exposure are the ones a build would use. Building its own with
 * `shadows: false` made this thumbnail a fourth way of projecting the same kind
 * of scene, diverging from the other three for no reason anyone chose.
 */
export class ModelPreview implements PreviewSurface {
  private viewport: EditorViewport | null = null;
  private controls: OrbitControls | null = null;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(45, 1, 0.01, 10_000);
  /** The loaded file, untouched. Settings are applied to the pivot above it. */
  private readonly pivot = new Group();
  private model: Object3D | null = null;
  private disposed = false;

  async open(container: HTMLElement, url: string): Promise<ModelFacts | null> {
    // The one viewport of this window, created if the dock has not asked for it
    // yet. Nothing here needs it to be showing anything: a viewport with no
    // panel measures a zero box for the Scene view and sizes its surface to
    // whatever else is asking, which is this.
    const viewport = await acquireViewport();
    if (this.disposed) return null;
    this.viewport = viewport;

    this.scene.background = new Color(BACKDROP);
    this.scene.add(this.pivot);
    this.buildLights();

    // The canvas comes back from the attach because `OrbitControls` needs an
    // element, and the element belongs to the view rather than to this.
    const canvas = viewport.attachPreview(container, this.scene, this.camera, () =>
      this.controls?.update(),
    );

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
    // First, so that the frame loop has stopped asking this for a scene before
    // the geometry under it is taken apart.
    this.viewport?.detachPreview();
    this.viewport = null;
    this.controls?.dispose();
    this.model?.traverse((child) => {
      const mesh = child as Partial<Mesh>;
      mesh.geometry?.dispose();
      for (const material of materialsOf(mesh.material)) material.dispose();
    });
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
   *
   * The aspect is not set here: the view is the viewport's, and it writes the
   * aspect from the panel's own box every time that box can have moved.
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
