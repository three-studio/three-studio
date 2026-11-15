import { planFields, type Infer, type Schema } from '../fieldSchema';
import type { AssetId } from '../ids';

/*
 * The material vocabulary. Shared for the same reason geometry is: a mesh
 * carries one inline, an imported model points at one by asset id, and the
 * asset side of the editor reads them without either component in hand.
 */

/** A texture slot: an image asset, or none. */
const map = (label: string) => ({ type: 'asset', label, kind: 'texture' }) as const;

/**
 * A material, as its fields. The order is the pane's.
 *
 * The texture slots are asset ids, resolved through the asset registry. Colour
 * and emissive are authored in sRGB; the rest carry data — directions,
 * roughness, coverage — and stay linear, or the values the shader reads are not
 * the values the artist painted. A slot's strength shows once the slot is set.
 */
export const materialFields = {
  color: { type: 'color', label: 'Colour', default: '#b7b7b7' },
  roughness: { type: 'number', label: 'Roughness', default: 0.75, min: 0, max: 1, step: 0.01 },
  metalness: { type: 'number', label: 'Metalness', default: 0, min: 0, max: 1, step: 0.01 },
  emissive: { type: 'color', label: 'Emissive', default: '#000000' },
  emissiveIntensity: { type: 'number', label: 'Emissive power', default: 1, min: 0, max: 20, step: 0.1 },
  opacity: { type: 'number', label: 'Opacity', default: 1, min: 0, max: 1, step: 0.01 },
  transparent: { type: 'boolean', label: 'Transparent', default: false },
  wireframe: { type: 'boolean', label: 'Wireframe', default: false },
  /* Which faces are drawn. */
  side: {
    type: 'enum',
    label: 'Side',
    default: 'front',
    options: [
      { value: 'front', label: 'Front' },
      { value: 'back', label: 'Back' },
      { value: 'double', label: 'Double' },
    ],
  },
  /* Base colour. sRGB. */
  colorMap: map('Base colour map'),
  /* Tangent-space normals. Linear. */
  normalMap: map('Normal map'),
  normalScale: {
    type: 'number',
    label: 'Normal strength',
    default: 1,
    min: 0,
    max: 4,
    step: 0.05,
    shownWhen: { field: 'normalMap', notEquals: null },
  },
  /*
   * Height in the red channel, turned into a normal perturbation. Linear. An
   * alternative to `normalMap`, not a companion: three takes the normal map
   * when both are set and never mixes them. Cheaper to author, and it is also
   * what a displacement map usually looks like, so one file often serves both.
   */
  bumpMap: map('Bump map'),
  /*
   * Tied to the bump slot alone. It has no effect while a normal map is also
   * set — three picks one — but hiding the strength of a map that is visibly
   * assigned would read as the row being broken.
   */
  bumpScale: {
    type: 'number',
    label: 'Bump strength',
    default: 1,
    min: 0,
    max: 4,
    step: 0.05,
    shownWhen: { field: 'bumpMap', notEquals: null },
  },
  /* Read from the green channel, as in glTF. Linear. */
  roughnessMap: map('Roughness map'),
  /* Read from the blue channel, as in glTF. Linear. */
  metalnessMap: map('Metalness map'),
  /* sRGB. */
  emissiveMap: map('Emissive map'),
  /* Ambient occlusion, read from red. Linear. */
  aoMap: map('Occlusion map'),
  aoIntensity: {
    type: 'number',
    label: 'Occlusion strength',
    default: 1,
    min: 0,
    max: 1,
    step: 0.01,
    shownWhen: { field: 'aoMap', notEquals: null },
  },
  /* Opacity from the red channel; needs `transparent`. Linear. */
  alphaMap: map('Alpha map'),
  /*
   * Real geometry displacement: each vertex moves along its normal by the red
   * channel. Linear. Per vertex, not per pixel, so it shows on a subdivided
   * mesh alone — which is why the box and the plane offer segment counts. A
   * normal map fakes the lighting of detail without moving anything;
   * displacement changes the silhouette and the shadow.
   */
  displacementMap: map('Displacement map'),
  displacementScale: {
    type: 'number',
    label: 'Displacement',
    default: 0.1,
    min: -2,
    max: 2,
    step: 0.01,
    shownWhen: { field: 'displacementMap', notEquals: null },
  },
  /* Shifts the whole surface, so a mid-grey map can push in as well as out. */
  displacementBias: {
    type: 'number',
    label: 'Displacement bias',
    default: 0,
    min: -1,
    max: 1,
    step: 0.01,
    shownWhen: { field: 'displacementMap', notEquals: null },
  },
  /*
   * The UV transform, applied to every slot of this material. It lives on the
   * three `Texture`, not on the material, which is why the binder clones the
   * cached texture per material rather than sharing one instance.
   */
  tiling: { type: 'vec2', label: 'Tiling', default: [1, 1], step: 0.1 },
  offset: { type: 'vec2', label: 'Offset', default: [0, 0], step: 0.01 },
  /* How a texture repeats past the 0..1 UV range; `mirror` stops a tiled ground showing a hard seam. */
  wrap: {
    type: 'enum',
    label: 'Wrap',
    default: 'repeat',
    options: [
      { value: 'repeat', label: 'Repeat' },
      { value: 'clamp', label: 'Clamp' },
      { value: 'mirror', label: 'Mirror' },
    ],
  },
} as const satisfies Schema;

export type MaterialDef = Infer<typeof materialFields>;
export type MaterialSide = MaterialDef['side'];
export type TextureWrap = MaterialDef['wrap'];

/** The material's fields, planned once: its defaults, and the assets one names. */
const materialPlan = planFields(materialFields);

/** A material at its defaults, in `color`. */
export function createMaterial(color = '#b7b7b7'): MaterialDef {
  return { ...structuredClone(materialPlan.defaults), color };
}

/**
 * Every texture slot of a material, as asset ids, in the fields' order: what a
 * mesh's own material names, and what a material asset does — so the exporter
 * ships each map, and a slot added later is named by existing.
 */
export function materialAssets(material: MaterialDef): readonly (AssetId | null)[] {
  return materialPlan.assets(material);
}
