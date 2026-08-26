import type { MaterialDef } from '@three-studio/core';
import {
  BackSide,
  Color,
  DoubleSide,
  FrontSide,
  LinearSRGBColorSpace,
  Material,
  MeshStandardNodeMaterial,
  MirroredRepeatWrapping,
  ClampToEdgeWrapping,
  RepeatWrapping,
  SRGBColorSpace,
  Vector2,
  type Texture,
} from 'three/webgpu';
import type { ModelCache } from '../assets/ModelCache';

/*
 * Turning a `MaterialDef` into a three material, and writing a new one onto an
 * existing pair without replacing either.
 *
 * `patchMaterial` against `buildMaterial` is the first half of the phase-11
 * contract, and it predates it: a node material with a different texture slot
 * is a different shader pipeline, so only a change of *slot* may rebuild. That
 * distinction is what made an inspector drag on a subdivided ground go from
 * 240ms to nothing.
 */

export const WRAPPING = {
  repeat: RepeatWrapping,
  clamp: ClampToEdgeWrapping,
  mirror: MirroredRepeatWrapping,
} as const;

/**
 * Slots whose texture is a colour an artist picked, rather than data a shader
 * reads. Getting this wrong is invisible on a grey wall and glaring on
 * anything saturated: a linear base colour renders washed out, and an sRGB
 * normal map bends the light in the wrong direction.
 */
const SRGB_SLOTS: ReadonlySet<keyof MaterialDef> = new Set(['colorMap', 'emissiveMap']);

/** Every texture slot on a material, in one place so a new one cannot be missed. */
const TEXTURE_SLOTS = [
  'colorMap',
  'normalMap',
  'bumpMap',
  'roughnessMap',
  'metalnessMap',
  'emissiveMap',
  'aoMap',
  'alphaMap',
  'displacementMap',
] as const satisfies readonly (keyof MaterialDef)[];

/**
 * True when both materials reference the same files in the same slots.
 *
 * Everything else about a material — its colours, its strengths, its UV
 * transform — can be written onto the objects that already exist. Only a change
 * of slot needs a new material, because that is what changes the shader.
 */
export function sameTextureSlots(a: MaterialDef, b: MaterialDef): boolean {
  return TEXTURE_SLOTS.every((slot) => a[slot] === b[slot]);
}

/** Writes new values onto a material and its textures, leaving both in place. */
export function patchMaterial(material: Material, textures: readonly Texture[], def: MaterialDef): void {
  const standard = material as MeshStandardNodeMaterial;

  standard.color.set(def.color);
  standard.roughness = def.roughness;
  standard.metalness = def.metalness;
  standard.emissive.set(def.emissive);
  standard.emissiveIntensity = def.emissiveIntensity;
  standard.opacity = def.opacity;
  standard.wireframe = def.wireframe;
  standard.normalScale = new Vector2(def.normalScale, def.normalScale);
  standard.bumpScale = def.bumpScale;
  standard.aoMapIntensity = def.aoIntensity;
  standard.displacementScale = def.displacementScale;
  standard.displacementBias = def.displacementBias;

  const side = def.side === 'double' ? DoubleSide : def.side === 'back' ? BackSide : FrontSide;
  // These two change how the material is compiled and sorted, so three has to
  // be told; the rest are plain uniforms.
  if (standard.transparent !== def.transparent || standard.side !== side) {
    standard.transparent = def.transparent;
    standard.side = side;
    standard.needsUpdate = true;
  }

  for (const texture of textures) {
    texture.wrapS = WRAPPING[def.wrap];
    texture.wrapT = WRAPPING[def.wrap];
    texture.repeat.set(def.tiling[0], def.tiling[1]);
    texture.offset.set(def.offset[0], def.offset[1]);
  }
}

export function buildMaterial(
  def: MaterialDef,
  models: ModelCache,
): { material: Material; textures: Texture[] } {
  const material = new MeshStandardNodeMaterial({
    color: new Color(def.color),
    roughness: def.roughness,
    metalness: def.metalness,
    emissive: new Color(def.emissive),
    emissiveIntensity: def.emissiveIntensity,
    opacity: def.opacity,
    transparent: def.transparent,
    wireframe: def.wireframe,
    side: def.side === 'double' ? DoubleSide : def.side === 'back' ? BackSide : FrontSide,
  });

  const textures: Texture[] = [];

  /** Each slot gets its own texture instance, which this material then owns. */
  const slot = (assetId: string | null, key: keyof MaterialDef): Texture | null => {
    if (assetId === null) return null;
    const texture = models.instanceTexture(assetId);
    if (texture === null) return null;

    texture.colorSpace = SRGB_SLOTS.has(key) ? SRGBColorSpace : LinearSRGBColorSpace;
    texture.wrapS = WRAPPING[def.wrap];
    texture.wrapT = WRAPPING[def.wrap];
    texture.repeat = new Vector2(def.tiling[0], def.tiling[1]);
    texture.offset = new Vector2(def.offset[0], def.offset[1]);
    textures.push(texture);
    return texture;
  };

  material.map = slot(def.colorMap, 'colorMap');
  material.normalMap = slot(def.normalMap, 'normalMap');
  material.normalScale = new Vector2(def.normalScale, def.normalScale);
  material.bumpMap = slot(def.bumpMap, 'bumpMap');
  material.bumpScale = def.bumpScale;
  material.roughnessMap = slot(def.roughnessMap, 'roughnessMap');
  material.metalnessMap = slot(def.metalnessMap, 'metalnessMap');
  material.emissiveMap = slot(def.emissiveMap, 'emissiveMap');
  material.aoMap = slot(def.aoMap, 'aoMap');
  material.aoMapIntensity = def.aoIntensity;
  material.alphaMap = slot(def.alphaMap, 'alphaMap');
  material.displacementMap = slot(def.displacementMap, 'displacementMap');
  material.displacementScale = def.displacementScale;
  material.displacementBias = def.displacementBias;

  return { material, textures };
}

/**
 * Writes a new definition onto an existing light or camera, or says it cannot.
 *
 * `false` means the object has to be rebuilt — a light of a different `kind` is
 * a different class, and a camera of a different projection likewise. Anything
 * else is scalars, and rewriting them keeps the shadow map that the light
 * already owns instead of allocating another and dropping this one on the floor.
 */
