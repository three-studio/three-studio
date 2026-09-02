import {
  Fn,
  add,
  cameraPosition,
  div,
  dot,
  float,
  length,
  max,
  mix,
  mul,
  normalize,
  positionWorld,
  pow,
  reflect,
  reflector,
  sub,
  texture,
  time,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import {
  Color,
  Mesh,
  NodeMaterial,
  Vector2,
  Vector3,
  type BufferGeometry,
  type ColorRepresentation,
  type Texture,
} from 'three/webgpu';
import type { Node } from 'three/webgpu';
import type { StudioTime } from '../time/StudioTime';

/*
 * Flat reflective water. A fork of `three/addons/objects/WaterMesh.js` (MIT),
 * kept close enough to the original to be rebased against it.
 *
 * Four things differ, and every one of them is something the addon puts out of
 * reach after construction:
 *
 * 1. **Speed.** The addon reads three's global `time` node directly, so every
 *    surface in a scene moves at exactly one rate. Here the shader reads a rate
 *    and an offset this object owns.
 * 2. **Direction.** The addon's four noise layers scroll in four fixed
 *    directions. Here the sampled position is turned first, which turns the flow
 *    and the pattern together. At an angle of zero the rotation is the identity,
 *    so the default look is the addon's exactly.
 * 3. **Choppiness.** The `1.5, 1.0, 1.5` that flattens the wave normals is a
 *    uniform rather than three literals.
 * 4. **The reflector.** The addon builds it inside the `Fn` that becomes
 *    `colorNode` and parents its target under the mesh. Here it is built once,
 *    before the `Fn`, kept on the instance, and aimed at this mesh — so
 *    `resolutionScale` can be written afterwards, nothing is added to the scene
 *    graph, and `dispose` can reach the render targets without walking a node
 *    graph to find them.
 */

export interface WaterSurfaceOptions {
  /** Required: the shader samples it four times per pixel and cannot do without. */
  waterNormals: Texture;
  /**
   * The clock the surface moves on.
   *
   * Taken rather than reached for, because the coupling exists either way: the
   * shader reads three's `time` node, which `StudioTime.install` has re-pointed
   * at this very object. Holding it makes that visible, and lets `speed` stay a
   * plain property — see the setter.
   */
  time: StudioTime;
  resolutionScale?: number;
  alpha?: number;
  size?: number;
  distortionScale?: number;
  speed?: number;
  /** Radians. Which way the water runs. */
  direction?: number;
  choppiness?: number;
  waterColor?: ColorRepresentation;
  sunColor?: ColorRepresentation;
  sunDirection?: Vector3;
}

export class WaterSurface extends Mesh<BufferGeometry, NodeMaterial> {
  readonly isWaterSurface = true;

  /** The normal map. Swap the image with `waterNormals.value = texture`. */
  readonly waterNormals;

  readonly alpha = uniform(1);
  readonly size = uniform(1);
  readonly distortionScale = uniform(20);
  readonly choppiness = uniform(1.5);
  readonly waterColor = uniform(new Color(0x7f7f7f));
  readonly sunColor = uniform(new Color(0xffffff));
  readonly sunDirection = uniform(new Vector3(0.70707, 0.70707, 0));

  /** The reflection pass. Held so `resolutionScale` and `dispose` can reach it. */
  private readonly reflection;

  /** `(cos θ, sin θ)`, so the shader never computes a transcendental. */
  private readonly flow = uniform(new Vector2(1, 0));
  private readonly rate = uniform(1);
  /**
   * What keeps a change of `speed` from jumping. The shader reads
   * `time · rate + phase`; see the setter.
   */
  private readonly phase = uniform(0);
  private heading = 0;
  private readonly clock: StudioTime;

  constructor(geometry: BufferGeometry, options: WaterSurfaceOptions) {
    const material = new NodeMaterial();
    super(geometry, material);

    this.clock = options.time;
    this.waterNormals = texture(options.waterNormals);

    if (options.alpha !== undefined) this.alpha.value = options.alpha;
    if (options.size !== undefined) this.size.value = options.size;
    if (options.distortionScale !== undefined) this.distortionScale.value = options.distortionScale;
    if (options.choppiness !== undefined) this.choppiness.value = options.choppiness;
    if (options.waterColor !== undefined) this.waterColor.value.set(options.waterColor);
    if (options.sunColor !== undefined) this.sunColor.value.set(options.sunColor);
    if (options.sunDirection !== undefined) this.sunDirection.value.copy(options.sunDirection);
    if (options.speed !== undefined) this.rate.value = options.speed;
    if (options.direction !== undefined) this.direction = options.direction;

    // Before the `Fn` rather than inside it, which is where the addon puts it.
    // Two things follow: the node is reachable afterwards, and exactly one is
    // built even if the body is evaluated again for a second shader stage.
    //
    // `target: this` because the reflector reads its target only for a position
    // and a local +Z normal, which is what a `PlaneGeometry` already is. The
    // addon parents a bare `Object3D` under the mesh to say the same thing.
    // Self-reflection is prevented by the reflector hiding the material it is
    // drawing for, not by the target being a separate object.
    const reflection = reflector({ target: this });
    reflection.reflector.resolutionScale = options.resolutionScale ?? 0.5;
    this.reflection = reflection;

    // TSL — from here to the end of the constructor this is the addon's shader.

    // The addon wraps this in a `Fn`. Inlined here because it is called exactly
    // once: a shader function of one call site generates the same arithmetic and
    // costs a type annotation for `uv` that the TSL types cannot express well.

    // A rate and an offset this object owns, where the addon reads `time`
    // directly. That is what lets two surfaces in one scene move at different
    // speeds, and `phase` is what keeps a change of rate from jumping.
    const offset = time.mul(this.rate).add(this.phase);

    // Turned before it is scaled. Rotating the position rotates the flow and the
    // pattern together, which is what a direction dial should do, and it costs
    // one rotation for the whole surface rather than one per noise layer. At an
    // angle of zero `flow` is `(1, 0)` and this is the identity.
    const ground = positionWorld.xz;
    const uv = vec2(
      ground.x.mul(this.flow.x).sub(ground.y.mul(this.flow.y)),
      ground.x.mul(this.flow.y).add(ground.y.mul(this.flow.x)),
    ).mul(this.size);

    const uv0 = add(div(uv, 103), vec2(div(offset, 17), div(offset, 29))).toVar();
    const uv1 = div(uv, 107).sub(vec2(div(offset, -19), div(offset, 31))).toVar();
    const uv2 = add(div(uv, vec2(8907.0, 9803.0)), vec2(div(offset, 101), div(offset, 97))).toVar();
    const uv3 = sub(div(uv, vec2(1091.0, 1027.0)), vec2(div(offset, 109), div(offset, -113))).toVar();

    const noise = this.waterNormals
      .sample(uv0)
      .add(this.waterNormals.sample(uv1))
      .add(this.waterNormals.sample(uv2))
      .add(this.waterNormals.sample(uv3))
      .mul(0.5)
      .sub(1);

    // The addon's `1.5, 1.0, 1.5`. Flattening the horizontal components is what
    // turns a normal map into a swell; raising them makes it a chop.
    const surfaceNormal = normalize(noise.xzy.mul(vec3(this.choppiness, 1.0, this.choppiness)));

    // Read as vectors once.
    //
    // `uniform(new Color())` is a `color` node, and `ColorExtensions` in
    // `@types/three` is empty — a colour there has no arithmetic at all, though
    // the runtime treats it as the `vec3` it is. An assertion rather than a
    // conversion because there is nothing to convert; this is the same wall
    // `systems/sky.ts` documents hitting on `colorNode`, and the same answer.
    const sunColor = this.sunColor as unknown as Node<'vec3'>;
    const waterColor = this.waterColor as unknown as Node<'vec3'>;

    const worldToEye = cameraPosition.sub(positionWorld);
    const eyeDirection = normalize(worldToEye);

    const reflectionDirection = normalize(reflect(this.sunDirection.negate(), surfaceNormal));
    const facing = max(0.0, dot(eyeDirection, reflectionDirection));
    const specularLight = pow(facing, 100).mul(sunColor).mul(2.0);
    const diffuseLight = max(dot(this.sunDirection, surfaceNormal), 0.0).mul(sunColor).mul(0.5);

    const distance = length(worldToEye);

    const distortion = surfaceNormal.xz
      .mul(float(0.001).add(float(1.0).div(distance)))
      .mul(this.distortionScale);

    material.transparent = true;
    material.opacityNode = this.alpha;
    material.receivedShadowPositionNode = positionWorld.add(distortion);

    // A graph edit rather than shader code, so it belongs outside the `Fn` the
    // addon puts it in — it has to happen once, not once per build of the body.
    // Non-null in practice: a `ReflectorNode` is a `TextureNode`, which always
    // has one. Guarded rather than asserted, because losing the distortion is a
    // duller surface and asserting would be a crash.
    const mirrorUv = reflection.uvNode;
    if (mirrorUv !== null) reflection.uvNode = mirrorUv.add(distortion);

    material.colorNode = Fn(() => {
      const theta = max(dot(eyeDirection, surfaceNormal), 0.0);
      const rf0 = float(0.02);
      const reflectance = mul(pow(float(1.0).sub(theta), 5.0), float(1.0).sub(rf0)).add(rf0);
      const scatter = max(0.0, dot(surfaceNormal, eyeDirection)).mul(waterColor);

      return mix(
        sunColor.mul(diffuseLight).mul(0.3).add(scatter),
        reflection.rgb.add(specularLight),
        reflectance,
      );
    })();
  }

  /**
   * Reflection resolution, as a fraction of the viewport.
   *
   * Writable at any time: the reflector re-reads it every frame in
   * `_updateResolution`. Not free, though — `RenderTarget.setSize` disposes and
   * rebuilds the target on any actual change, so this wants a coarse step rather
   * than a continuous drag.
   */
  get resolutionScale(): number {
    return this.reflection.reflector.resolutionScale;
  }

  set resolutionScale(value: number) {
    this.reflection.reflector.resolutionScale = value;
  }

  get speed(): number {
    return this.rate.value;
  }

  /**
   * How fast the water runs. 0 holds it still; the scene's timescale still
   * multiplies whatever this says.
   *
   * The shader reads `time · rate + phase`, and `phase` moves with every change
   * so that the value does not. Without it, a slider notch five minutes into a
   * session would teleport the waves by fifteen seconds of motion:
   *
   *     t·s₀ + p₀  ==  t·s₁ + p₁      ⟹      p₁ = p₀ + t·(s₀ − s₁)
   *
   * An accumulator advanced per frame would be continuous without the algebra,
   * and there is nowhere to run one: a system has no frame hook, a behaviour
   * only exists in play mode, and `onBeforeRender` fires once per camera.
   */
  set speed(value: number) {
    if (!Number.isFinite(value) || value < 0) return;
    const previous = this.rate.value;
    if (previous === value) return;
    this.phase.value += this.clock.elapsed * (previous - value);
    this.rate.value = value;
  }

  /** Which way the water runs, in radians. */
  get direction(): number {
    return this.heading;
  }

  set direction(radians: number) {
    if (!Number.isFinite(radians)) return;
    this.heading = radians;
    // The only place a sine is taken. The shader gets the pair.
    this.flow.value.set(Math.cos(radians), Math.sin(radians));
  }

  /**
   * Frees the material and every render target the reflection was drawn into.
   *
   * The reflector holds one full-viewport colour buffer per camera it has been
   * seen by, and `Material.dispose` does not reach them — `NodeMaterial` does
   * not override it, so nothing walks the graph. The geometry is not freed here:
   * it comes from the arena's pool and outlives any one surface.
   */
  dispose(): void {
    this.reflection.dispose();
    this.material.dispose();
  }
}
