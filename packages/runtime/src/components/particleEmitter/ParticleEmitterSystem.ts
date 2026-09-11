import type { ParticleEmitterComponent } from '@three-studio/core';
import { attribute, texture, time, uniform, vec2, vec3 } from 'three/tsl';
import {
  AdditiveBlending,
  Color,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  SpriteNodeMaterial,
  Vector3,
  type BufferGeometry,
  type Node,
  type Texture,
} from 'three/webgpu';
import {
  ComponentSystem,
  type SystemContext,
  type SystemHandle,
} from '../../systems/ComponentSystem';
import { ENTITY_ID_KEY } from '../../systems/identity';
import { defaultParticleSprite } from './particleSprite';

/*
 * A stream of billboarded particles, as one draw call and one shader.
 *
 * The emitter is a quad drawn once per particle, and each instance reads its
 * own constants — where it was born, how it was thrown, when in the cycle it
 * is — out of three instanced attributes. Nothing is stepped on the CPU and no
 * buffer is written per frame: a particle's position at any moment is
 * `origin + v·t + ½at²`, and `t` comes off the simulation's clock. That is what
 * makes this cheap enough to be worth having, and it is also why there are no
 * bursts and no per-particle forces — both need state carried between frames,
 * which is a compute pass and a different component.
 *
 * **The shader depends on no field of the component.** Every value it reads is
 * a uniform or an attribute, so `patch` never answers `'remount'`: changing the
 * particle count swaps a geometry the way editing a cube's segments does, and
 * the material, the pipeline and the `Mesh` all survive.
 */

/**
 * Ceiling on the particle count, whatever the document says.
 *
 * Not a taste: the buffers are `count · 7` floats and are allocated on the
 * spot, so a hand-edited file carrying a count of a hundred million would try
 * for two gigabytes before anything had a chance to say no.
 */
const MAX_PARTICLES = 100_000;

/**
 * The shortest lifetime the shader may be handed.
 *
 * The age is `time mod lifetime`, and a modulo by zero is NaN — which reaches
 * every particle's vertex position and takes the whole draw with it. Same
 * family as the hemisphere light's zero vector in `LightSystem`, and clamped
 * here rather than in the inspector because a document can be edited by hand.
 */
const MIN_LIFETIME = 0.01;

/*
 * The three per-particle attributes, named once.
 *
 * Prefixed because they share a namespace with everything else a geometry can
 * carry, and `position` and `uv` on this very geometry are the quad's.
 */
const ORIGIN = 'particleOrigin';
const JITTER = 'particleJitter';
const PHASE = 'particlePhase';

export interface ParticleEmitterHandle extends SystemHandle {
  mesh: Mesh<BufferGeometry, SpriteNodeMaterial>;
  /** Identifies the pooled geometry this handle holds a reference to. */
  geometryKey: string;
  geometry: BufferGeometry;
  /** What that geometry was baked from. */
  count: number;
  shape: ParticleEmitterComponent['shape'];
  uniforms: EmitterUniforms;
  /** `null` while the built-in sprite is in use — that one belongs to no handle. */
  spriteId: string | null;
  texture: Texture | null;
  additive: boolean;
  readonly objects: readonly Mesh[];
}

export class ParticleEmitterSystem extends ComponentSystem<
  ParticleEmitterComponent,
  ParticleEmitterHandle
> {
  mount(
    entityId: string,
    component: ParticleEmitterComponent,
    ctx: SystemContext,
  ): ParticleEmitterHandle {
    const count = countOf(component);
    const geometryKey = geometryKeyOf(count, component.shape);
    const geometry = ctx.arena.geometry(geometryKey, () => bakeGeometry(count, component.shape));
    const image = this.image(component, ctx);

    const material = new SpriteNodeMaterial();
    const uniforms = buildUniforms(image.map);
    writeUniforms(uniforms, component);
    bindShader(material, uniforms);
    applyBlending(material, component);
    /*
     * Particles do not occlude each other.
     *
     * A hundred overlapping sprites writing depth means the nearest one wins
     * per pixel and the rest are cut out of it — which reads as square holes
     * punched through a plume, and is the first thing anyone sees when this
     * line is missing. They still *read* depth, so a particle behind a wall
     * stays behind it.
     */
    material.depthWrite = false;

    const mesh = new Mesh(geometry, material);
    /*
     * Never culled.
     *
     * The geometry is one quad at the emitter's own origin, so its bounding
     * sphere is about 0.7 units across — and every particle is drawn somewhere
     * else entirely, by a vertex shader three cannot see into. An emitter whose
     * origin left the frame took its whole plume with it, however much of that
     * plume was still on screen.
     */
    mesh.frustumCulled = false;
    mesh.userData[ENTITY_ID_KEY] = entityId;

    return {
      mesh,
      geometryKey,
      geometry,
      count,
      shape: component.shape,
      uniforms,
      spriteId: component.spriteId,
      texture: image.texture,
      additive: component.additive,
      objects: [mesh],
    };
  }

  /**
   * Never `'remount'`.
   *
   * The per-particle constants are attributes of the geometry rather than
   * values folded into the node graph, which is what makes that true: the count
   * and the emission shape swap a geometry — pooled and reference-counted like
   * a mesh's — while the material, its compiled pipeline and the `Mesh` itself
   * carry on. Whatever is pointing at that object, the outline and the gizmo,
   * goes on pointing at the same thing.
   */
  patch(
    handle: ParticleEmitterHandle,
    _previous: ParticleEmitterComponent,
    next: ParticleEmitterComponent,
    ctx: SystemContext,
  ): ParticleEmitterHandle {
    writeUniforms(handle.uniforms, next);
    if (handle.additive !== next.additive) applyBlending(handle.mesh.material, next);

    let { geometry, geometryKey, texture: owned, spriteId } = handle;
    const count = countOf(next);
    const nextKey = geometryKeyOf(count, next.shape);
    if (geometryKey !== nextKey) {
      geometry = ctx.arena.geometry(nextKey, () => bakeGeometry(count, next.shape));
      ctx.arena.releaseGeometry(geometryKey);
      geometryKey = nextKey;
      handle.mesh.geometry = geometry;
    }

    if (spriteId !== next.spriteId) {
      // The old one goes back through the queue rather than being disposed
      // here: the frame in flight may still be sampling it.
      if (owned) ctx.arena.retire(owned);
      const image = this.image(next, ctx);
      handle.uniforms.map.value = image.map;
      owned = image.texture;
      spriteId = next.spriteId;
    }

    return {
      ...handle,
      geometry,
      geometryKey,
      count,
      shape: next.shape,
      spriteId,
      texture: owned,
      additive: next.additive,
    };
  }

  /**
   * The geometry back to the pool, the material and any sprite to the queue.
   *
   * The material is retired rather than disposed on the spot for the reason
   * every other system's is: the frame in flight may still be drawing with it.
   */
  unmount(handle: ParticleEmitterHandle, ctx: SystemContext): void {
    ctx.arena.releaseGeometry(handle.geometryKey);
    ctx.arena.retire(handle.mesh.material);
    if (handle.texture) ctx.arena.retire(handle.texture);
  }

  /**
   * The sprite image, or the built-in one.
   *
   * The built-in is returned with a `null` texture on purpose: it is shared by
   * every emitter and owned by none, so a handle must not retire it. Same
   * arrangement as a water surface's normal map.
   */
  private image(
    component: ParticleEmitterComponent,
    ctx: SystemContext,
  ): { texture: Texture | null; map: Texture } {
    const assetId = component.spriteId;
    const instance = assetId === null ? null : ctx.models.instanceTexture(assetId);
    if (!instance) return { texture: null, map: defaultParticleSprite() };
    return { texture: instance, map: instance };
  }
}

/** Everything the shader reads that is not per-particle. */
function buildUniforms(map: Texture) {
  return {
    lifetime: uniform(1),
    gravity: uniform(0),
    size: uniform(1),
    opacity: uniform(1),
    colour: uniform(new Color(0xffffff)),
    velocity: uniform(new Vector3()),
    spread: uniform(new Vector3()),
    /** What the baked origins, which span −1..1, are multiplied by. */
    emitScale: uniform(new Vector3()),
    map: texture(map),
  };
}

type EmitterUniforms = ReturnType<typeof buildUniforms>;

/**
 * Where each field lands, written once so that `mount` and `patch` cannot
 * disagree about it — the failure `applyShadow` in `LightSystem` was extracted
 * to end.
 */
function writeUniforms(uniforms: EmitterUniforms, component: ParticleEmitterComponent): void {
  uniforms.lifetime.value = Math.max(component.lifetime, MIN_LIFETIME);
  uniforms.gravity.value = component.gravity;
  uniforms.size.value = component.size;
  uniforms.opacity.value = component.opacity;
  uniforms.colour.value.set(component.color);
  uniforms.velocity.value.fromArray(component.velocity);
  uniforms.spread.value.fromArray(component.spread);
  writeEmitScale(uniforms.emitScale.value, component);
}

/** The emitter's extent, in the units the baked origins are expressed in. */
function writeEmitScale(target: Vector3, component: ParticleEmitterComponent): void {
  if (component.shape === 'sphere') target.setScalar(component.radius);
  // The baked origins span −0.5..0.5 in a box, so `extents` is a full width
  // rather than a half-extent — which is what an author reads off a box.
  else if (component.shape === 'box') target.fromArray(component.extents);
  // A point emitter's origins are all zero; this only has to not be NaN.
  else target.setScalar(0);
}

/**
 * The shader: one expression per node slot, no branches, and no mention of any
 * field of the component. That is what lets `patch` keep the pipeline.
 */
function bindShader(material: SpriteNodeMaterial, u: EmitterUniforms): void {
  const origin = attribute<'vec3'>(ORIGIN, 'vec3');
  const jitter = attribute<'vec3'>(JITTER, 'vec3');
  const phase = attribute<'float'>(PHASE, 'float');

  /*
   * The particle's own age, wrapped into its lifetime.
   *
   * Wrapping is the whole trick: a fixed set of particles reads as an endless
   * stream because each is born again at the emitter the instant it reaches the
   * end of its life, and `phase` is what staggers those births apart.
   *
   * `time` is the simulation's clock, not three's — `StudioTime.install` has
   * re-pointed the node — so Pause holds a plume still and the timescale slows
   * it, without this file knowing either exists.
   */
  const age = time.add(phase.mul(u.lifetime)).mod(u.lifetime);

  const drift = u.velocity.add(jitter.mul(u.spread));
  // ½at², downward. Negative because `gravity` is a magnitude and it is the
  // emitter's own frame that says which way is up.
  const fall = vec3(0, u.gravity.mul(age).mul(age).mul(-0.5), 0);

  // Object space: `SpriteNodeMaterial` puts `positionNode` through the model
  // view matrix and turns the quad to face the camera around it, so the
  // emitter's transform places, turns and scales the whole plume — and
  // `velocity` is read in the frame the author sees on the gizmo.
  material.positionNode = origin.mul(u.emitScale).add(drift.mul(age)).add(fall);
  material.scaleNode = vec2(u.size);
  // `uniform(new Color())` is a colour node, and `ColorExtensions` in
  // `@types/three` is empty — a colour there has no arithmetic, though the
  // runtime treats it as the `vec3` it is. Same wall, and same answer, as
  // `WaterSurface` and `systems/sky.ts`.
  material.colorNode = (u.colour as unknown as Node<'vec3'>).mul(u.map.rgb);
  // Fades to nothing over the particle's life. Always, and not as an option: a
  // particle that vanishes at full opacity pops, and a stream of them flickers.
  material.opacityNode = u.opacity.mul(age.div(u.lifetime).oneMinus()).mul(u.map.a);
}

function applyBlending(material: SpriteNodeMaterial, component: ParticleEmitterComponent): void {
  material.blending = component.additive ? AdditiveBlending : NormalBlending;
  // Blending is baked into the render pipeline, which three rebuilds only when
  // the material says it has changed — unlike `side`, which is state it can set.
  material.needsUpdate = true;
}

/** What the document asks for, kept inside what the machine can be asked for. */
function countOf(component: ParticleEmitterComponent): number {
  if (!Number.isFinite(component.count)) return 0;
  return Math.min(Math.max(Math.floor(component.count), 0), MAX_PARTICLES);
}

/**
 * Two emitters with the same count and shape get the same geometry.
 *
 * They can, because the seeds below are a pure function of those two — which is
 * the second thing determinism buys, after making an emitter look the same in
 * the editor and in the exported build.
 */
function geometryKeyOf(count: number, shape: ParticleEmitterComponent['shape']): string {
  return `particles:${count}:${shape}`;
}

/**
 * The quad, and the per-particle constants beside it.
 *
 * Its own geometry rather than the one `Sprite` shares across the process, and
 * that is not a preference. An instanced attribute reaches the GPU with a
 * per-instance step **only** when it is a real `InstancedBufferAttribute` on
 * the geometry: handing a plain array to TSL's `instancedBufferAttribute` puts
 * it in an interleaved buffer that is not instanced, so every particle reads
 * slot zero and the whole plume collapses onto the emitter's origin. It draws,
 * it compiles, and it is silently one particle. Owning the geometry also means
 * `dispose()` frees these buffers, which nothing frees for a node-level
 * attribute hung off a geometry nobody disposes.
 */
function bakeGeometry(
  count: number,
  shape: ParticleEmitterComponent['shape'],
): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry();

  // three's own sprite quad, written out: a unit square centred on its origin,
  // which is what `SpriteNodeMaterial` expects to find in `positionGeometry`.
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3),
  );
  geometry.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geometry.instanceCount = count;

  // Never a zero-length buffer: an author may dial the count down to nothing,
  // and a GPU buffer of no bytes is a device error rather than an empty draw.
  // `instanceCount` above is what actually stops anything being drawn.
  const slots = Math.max(count, 1);
  const random = seeded(0x9e3779b9);
  const origins = new Float32Array(slots * 3);
  const jitters = new Float32Array(slots * 3);
  const phases = new Float32Array(slots);

  for (let i = 0; i < slots; i += 1) {
    const at = i * 3;
    if (shape === 'sphere') {
      // Rejected until it lands inside the ball, which is the one form of this
      // that is obviously uniform. About half the draws are kept, and this runs
      // once per distinct count and shape rather than once per frame.
      let x = 0;
      let y = 0;
      let z = 0;
      do {
        x = random() * 2 - 1;
        y = random() * 2 - 1;
        z = random() * 2 - 1;
      } while (x * x + y * y + z * z > 1);
      origins[at] = x;
      origins[at + 1] = y;
      origins[at + 2] = z;
    } else if (shape === 'box') {
      origins[at] = random() - 0.5;
      origins[at + 1] = random() - 0.5;
      origins[at + 2] = random() - 0.5;
    }

    jitters[at] = random() * 2 - 1;
    jitters[at + 1] = random() * 2 - 1;
    jitters[at + 2] = random() * 2 - 1;

    // Evenly spread rather than random: an emitter emits at a rate, and random
    // phases clump births together and leave gaps between them.
    phases[i] = i / slots;
  }

  geometry.setAttribute(ORIGIN, new InstancedBufferAttribute(origins, 3));
  geometry.setAttribute(JITTER, new InstancedBufferAttribute(jitters, 3));
  geometry.setAttribute(PHASE, new InstancedBufferAttribute(phases, 1));
  return geometry;
}

/**
 * mulberry32: thirty-two bits of state, and good enough for a cloud of dots.
 *
 * Seeded on purpose, and it is not a detail. The constants are baked once, so
 * `Math.random` would give the editor and the exported build two different
 * plumes out of one document, and would reshuffle every particle each time the
 * count was nudged by one. A document that describes a scene has to describe
 * this one too.
 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
