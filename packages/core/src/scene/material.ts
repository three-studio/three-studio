import type { Hex, Vec2 } from './primitives';

/*
 * The material vocabulary. Shared for the same reason geometry is: a mesh
 * carries one inline, an imported model points at one by asset id, and the
 * asset side of the editor reads them without either component in hand.
 */

/** Which faces are drawn. Named because two component types now take it. */
export type MaterialSide = 'front' | 'back' | 'double';

export const MATERIAL_SIDE_LABELS: Record<MaterialSide, string> = {
  front: 'Front',
  back: 'Back',
  double: 'Double',
};

/**
 * How a texture repeats past the 0..1 UV range. Named after three's constants;
 * `mirror` is what stops a tiled ground from showing a hard seam.
 */
export type TextureWrap = 'repeat' | 'clamp' | 'mirror';

export const TEXTURE_WRAP_LABELS: Record<TextureWrap, string> = {
  repeat: 'Repeat',
  clamp: 'Clamp',
  mirror: 'Mirror',
};

export interface MaterialDef {
  color: Hex;
  roughness: number;
  metalness: number;
  emissive: Hex;
  emissiveIntensity: number;
  opacity: number;
  transparent: boolean;
  wireframe: boolean;
  side: MaterialSide;

  /*
   * Texture slots. All asset ids, resolved through the asset registry.
   *
   * Colour and emissive are authored in sRGB; the rest carry data (directions,
   * roughness, coverage) and must stay linear, or the values the shader reads
   * are not the values the artist painted.
   */
  /** Base colour. sRGB. */
  colorMap: string | null;
  /** Tangent-space normals. Linear. */
  normalMap: string | null;
  normalScale: number;
  /**
   * Height in the red channel, converted to a normal perturbation. Linear.
   *
   * An alternative to `normalMap`, not a companion: three takes the normal map
   * when both are set and never mixes them. Cheaper to author — a grey-scale
   * height map rather than a baked tangent-space normal — and it is also what
   * a displacement map usually looks like, so the same file often serves both.
   */
  bumpMap: string | null;
  bumpScale: number;
  /** Read from the green channel, as in glTF. Linear. */
  roughnessMap: string | null;
  /** Read from the blue channel, as in glTF. Linear. */
  metalnessMap: string | null;
  /** sRGB. */
  emissiveMap: string | null;
  /** Ambient occlusion, read from red. Linear. */
  aoMap: string | null;
  aoIntensity: number;
  /** Opacity from the red channel; needs `transparent`. Linear. */
  alphaMap: string | null;
  /**
   * Real geometry displacement: each vertex moves along its normal by the red
   * channel. Linear.
   *
   * Per *vertex*, not per pixel, so it only shows on a subdivided mesh — which
   * is why the box and plane primitives expose segment counts. A normal map
   * fakes the lighting of detail without moving anything and costs nothing;
   * displacement changes the silhouette and the shadow.
   */
  displacementMap: string | null;
  displacementScale: number;
  /** Shifts the whole surface, so a mid-grey map can push in as well as out. */
  displacementBias: number;

  /*
   * UV transform, applied to every slot of this material. It lives on the
   * three `Texture`, not the material, which is why the binder clones the
   * cached texture per material rather than sharing one instance.
   */
  tiling: Vec2;
  offset: Vec2;
  wrap: TextureWrap;
}

// --- components -------------------------------------------------------------

export function createMaterial(color = '#b7b7b7'): MaterialDef {
  return {
    color,
    roughness: 0.75,
    metalness: 0,
    emissive: '#000000',
    emissiveIntensity: 1,
    opacity: 1,
    transparent: false,
    wireframe: false,
    side: 'front',
    colorMap: null,
    normalMap: null,
    normalScale: 1,
    bumpMap: null,
    bumpScale: 1,
    roughnessMap: null,
    metalnessMap: null,
    emissiveMap: null,
    aoMap: null,
    aoIntensity: 1,
    alphaMap: null,
    displacementMap: null,
    displacementScale: 0.1,
    displacementBias: 0,
    tiling: [1, 1],
    offset: [0, 0],
    wrap: 'repeat',
  };
}
