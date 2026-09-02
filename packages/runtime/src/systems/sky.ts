import type { SkySettings } from '@three-studio/core';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { nodeObject, uniform, vec4 } from 'three/tsl';
import {
  MathUtils,
  PMREMGenerator,
  Scene,
  Spherical,
  Vector3,
  type RenderTarget,
  type Renderer,
  type Texture,
} from 'three/webgpu';

/**
 * Cube face size the sky is captured at for the light it casts.
 *
 * The resolution is thrown away anyway: a prefiltered radiance map is a blur
 * chain over a cubemap, and the roughest mip a material samples is a handful of
 * pixels. 256 is three's own default and is indistinguishable from 1024 on
 * anything but a chrome ball. The sky as *seen* is not captured at all — see
 * the class below.
 */
const RADIANCE_SIZE = 256;

/**
 * Everything that is one number on each side.
 *
 * Three settings are not. `elevation` and `azimuth` are two halves of one
 * `sunPosition`; and `sunDisc` is a boolean here and a float there, forced off
 * on the captured mesh whatever the document says.
 *
 * `cloudSpeed` used to be a fourth, written by whoever knew whether this sky was
 * watched or captured. It is an ordinary uniform again: the clock the shader
 * multiplies it by is the simulation's now, so a paused scene holds its clouds
 * still without anyone here deciding that. See `time/StudioTime`.
 */
type SkyUniformKey = Exclude<keyof SkySettings, 'elevation' | 'azimuth' | 'sunDisc'>;

/**
 * Pairs a setting with the uniform it drives, keeping the key literal.
 *
 * Written through a generic rather than as a `Record` so that reading it back
 * needs no cast: `Object.entries` widens a key to `string`, and indexing
 * `SkySettings` with that is exactly the assertion this file should not need.
 */
const bindUniform = <K extends SkyUniformKey>(
  key: K,
  uniform: (sky: SkyMesh) => { value: number },
): { key: K; uniform: (sky: SkyMesh) => { value: number } } => ({ key, uniform });

/**
 * Where each setting lands on the mesh.
 *
 * A table rather than eight assignments, so a uniform three adds is one line
 * here beside one line in `SkySettings`, instead of a hunt for wherever the
 * others happen to be written.
 */
const UNIFORMS = [
  bindUniform('turbidity', (sky) => sky.turbidity),
  bindUniform('rayleigh', (sky) => sky.rayleigh),
  bindUniform('mieCoefficient', (sky) => sky.mieCoefficient),
  bindUniform('mieDirectionalG', (sky) => sky.mieDirectionalG),
  bindUniform('cloudCoverage', (sky) => sky.cloudCoverage),
  bindUniform('cloudDensity', (sky) => sky.cloudDensity),
  bindUniform('cloudScale', (sky) => sky.cloudScale),
  bindUniform('cloudElevation', (sky) => sky.cloudElevation),
  bindUniform('cloudSpeed', (sky) => sky.cloudSpeed),
];

/**
 * A setting with nowhere to go is a compile error here rather than a slider
 * that quietly does nothing — which is the failure a table like this invites,
 * and the only reason it is worth having over eight assignments.
 */
type UnboundUniform = Exclude<SkyUniformKey, (typeof UNIFORMS)[number]['key']>;
const _everyUniformIsBound: [UnboundUniform] extends [never] ? true : UnboundUniform = true;

/**
 * The analytic sky: one mesh to look at, one capture to be lit by.
 *
 * The sky is **drawn**, not captured, because its cloud layer moves — the
 * fragment shader offsets the cloud UVs by `time * cloudSpeed`, and no snapshot
 * can show that. Drawing it costs one extra draw call; re-capturing it every
 * frame would cost a full cubemap and its blur chain.
 *
 * Its **light** is still captured, and only when the settings change. Drifting
 * clouds barely move the irradiance, so a radiance map that lags them is right
 * rather than merely cheap — it is the arrangement Unreal has, an animated sky
 * material in front of a SkyLight that captured it once.
 *
 * The capture hands `scene.environment` a `CubeUVReflectionMapping` texture,
 * which short-circuits `PMREMNode`: it is used as the prefiltered image it
 * already is rather than being prefiltered a second time.
 */
export class ProceduralSky {
  /** Holds the captured mesh alone, so a capture sees the sky and nothing else. */
  private readonly stage = new Scene();
  private readonly sun = new Vector3();
  private readonly spherical = new Spherical();

  /**
   * How bright the sky is *seen*, with no say in the light it casts.
   *
   * `scene.backgroundIntensity` is the usual home for this, and it has nothing
   * to act on here: the sky is a mesh, so `scene.background` is null. Recovered
   * by multiplying the material's own colour — see `createDisplay`.
   */
  private readonly intensity = uniform(1);

  private display: SkyMesh | null = null;
  private captureMesh: SkyMesh | null = null;
  private generator: PMREMGenerator | null = null;
  private target: RenderTarget | null = null;
  /**
   * The settings the held capture was made from.
   *
   * Compared by identity, which immer makes exact: a document edit that did not
   * touch the sky hands back the very same object, so this is a pointer compare
   * per sync rather than eight number compares — and, far more to the point,
   * rather than a cubemap capture.
   */
  private captured: SkySettings | null = null;

  /**
   * Puts the sky on this scene and writes its uniforms.
   *
   * @param intensity What `scene.backgroundIntensity` would have scaled. Only
   *   what is seen: the light this sky casts is scaled by
   *   `environmentIntensity`, on a capture this never touches, and applying
   *   both would count one setting twice.
   */
  attach(scene: Scene, settings: SkySettings, intensity: number): void {
    const mesh = (this.display ??= this.createDisplay());
    this.apply(mesh, settings);
    this.intensity.value = intensity;
    if (mesh.parent !== scene) scene.add(mesh);
  }

  /** Takes it back off, for a scene that has stopped asking for one. */
  detach(): void {
    this.display?.removeFromParent();
  }

  /**
   * The prefiltered radiance of this sky, capturing it if it has changed.
   *
   * `null` before the device exists. `WebGPURenderer.init()` is async and a
   * capture is six draw calls and a blur chain, so there is a window at startup
   * where the honest answer is "not yet" — the next sync will have one.
   */
  radiance(settings: SkySettings, renderer: Renderer): Texture | null {
    if (!renderer.hasInitialized()) return null;
    if (this.captured === settings && this.target !== null) return this.target.texture;

    const mesh = (this.captureMesh ??= this.createCapture());
    this.apply(mesh, settings);
    // Written over what `apply` just set, in this order on purpose: the capture
    // is a still image of a sky with no sun disc in it, whatever the document
    // asked the visible one for.
    mesh.showSunDisc.value = 0;
    mesh.cloudSpeed.value = 0;

    const generator = (this.generator ??= new PMREMGenerator(renderer));
    // Written into the target it was given, so settling a slider re-runs this
    // without allocating a render target per notch.
    this.target = generator.fromScene(this.stage, 0, 0.1, 100, {
      size: RADIANCE_SIZE,
      renderTarget: this.target,
    });

    this.captured = settings;
    return this.target.texture;
  }

  /**
   * The mesh the camera sees.
   *
   * Every flag here exists to make its size irrelevant. It is drawn first and
   * tests no depth, so nothing occludes it and it occludes nothing; it is never
   * culled; and it is recentred on the camera, so the only thing its scale
   * decides is whether it survives the near and far planes.
   */
  private createDisplay(): SkyMesh {
    const mesh = new SkyMesh();

    // `SkyMesh` already sets `BackSide` and `depthWrite = false`. Depth testing
    // is the one it leaves on, and leaving it on is what would let a wall five
    // metres away cut a hole in the sky.
    mesh.material.depthTest = false;

    // The colour the sky computes, scaled by the background intensity. Wrapped
    // once here rather than rebuilt per change, so the slider writes a uniform
    // instead of recompiling a shader.
    //
    // The whole vector, alpha included. Scaling only `rgb` would be tidier, and
    // it cannot be typed: three declares `colorNode` as a union of five node
    // widths, `nodeObject` is the only way back into the fluent API without an
    // assertion, and `.rgb` exists on none of the union's members — a float
    // node has no red channel. `mul` is what they all share.
    //
    // It costs nothing here: the material is opaque, so the alpha this scales
    // is discarded by the pipeline. A sky that ever becomes transparent would
    // need the split, and would have to buy it with a narrowing predicate.
    const computed = mesh.material.colorNode;
    if (computed !== null) {
      mesh.material.colorNode = nodeObject(computed).mul(this.intensity);
    }
    // Finite rather than `-Infinity`: the sort is `a.renderOrder - b.renderOrder`
    // (`RenderList.js`), and two infinities give `NaN`.
    mesh.renderOrder = -1000;
    mesh.frustumCulled = false;
    // Ten units puts the faces five from the camera — past any sane near plane,
    // inside any sane far one. Small on purpose: if the recentring below ever
    // stopped running, a box this size fails visibly on the first step rather
    // than drifting out of frame somewhere over the horizon.
    mesh.scale.setScalar(10);

    mesh.onBeforeRender = (_renderer, _scene, camera) => {
      // The camera's *world* position, not `camera.position`.
      //
      // In play mode the camera is parented under its entity's container —
      // `CameraSystem` hands it to the reconciler, which adds it there — and the
      // controller moves the container, so `camera.position` is an eye height
      // near nothing rather than the place being looked from. A sky placed from
      // that stayed at the origin, outside its own ten-unit box, and the game
      // drew a black sky while the water went on reflecting one. The editor
      // camera is parented to nothing, which is why only play mode showed it.
      //
      // `Engine.writeListenerFromCamera` has the same question and gives the
      // same answer; `getWorldPosition` does its `updateWorldMatrix` for us.
      // Writing into `position` is still the world position because the sky is
      // added straight to the `Scene` — see `syncSky`.
      camera.getWorldPosition(mesh.position);
      // The scene's matrices were built at the top of `render()`, so this needs
      // saying again. It lands on this frame rather than the next because the
      // hook runs at the head of `renderObject`, and the node that reads
      // `matrixWorld` for the model matrix (`Object3DNode`, update type OBJECT)
      // is updated after it, in `updateForRender`.
      mesh.updateMatrixWorld(true);
    };

    return mesh;
  }

  /**
   * The mesh that is captured — its own instance, not the visible one moved.
   *
   * That one lives centred on the camera and this one has to sit at the origin
   * of an empty scene, so sharing would mean saving and restoring a parent and
   * a position around every capture. `BoxGeometry(1, 1, 1)` unscaled puts the
   * faces at ±0.5 and the corners at 0.87, which the 0.1 / 100 capture frustum
   * contains with room to spare.
   */
  private createCapture(): SkyMesh {
    const mesh = new SkyMesh();
    this.stage.add(mesh);
    return mesh;
  }

  private apply(mesh: SkyMesh, settings: SkySettings): void {
    for (const { key, uniform } of UNIFORMS) uniform(mesh).value = settings[key];

    // A boolean in the document, a float in the shader. `radiance` writes 0
    // over this afterwards for the mesh it captures, whatever was asked for.
    mesh.showSunDisc.value = settings.sunDisc ? 1 : 0;

    // Elevation is measured from the horizon and three's spherical phi from
    // straight up, which is the one conversion every sky example gets to write.
    this.spherical.set(
      1,
      MathUtils.degToRad(90 - settings.elevation),
      MathUtils.degToRad(settings.azimuth),
    );
    mesh.sunPosition.value.copy(this.sun.setFromSpherical(this.spherical));
  }

  /**
   * Frees the render target, the generator and both meshes.
   *
   * Not routed through the arena: a `RenderTarget` is not retired for a frame
   * like a texture the last frame may still be sampling — this runs when the
   * binder is being torn down and nothing is rendering any more.
   */
  dispose(): void {
    this.display?.removeFromParent();
    this.display?.geometry.dispose();
    this.captureMesh?.geometry.dispose();
    this.display?.material.dispose();
    this.captureMesh?.material.dispose();
    this.target?.dispose();
    this.generator?.dispose();

    this.display = null;
    this.captureMesh = null;
    this.target = null;
    this.generator = null;
    this.captured = null;
  }
}
