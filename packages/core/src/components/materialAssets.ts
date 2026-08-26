import type { MaterialDef } from '../scene/schema';

/**
 * Every texture slot of a material, as asset ids.
 *
 * Lifted out of `references.ts` so the mesh component's `assets` and the asset
 * collector share one list. Two copies of "the texture slots" is how a new slot
 * gets left out of the exported bundle and the model arrives untextured.
 */
export function materialAssets(material: MaterialDef): readonly (string | null)[] {
  return [
    material.colorMap,
    material.normalMap,
    material.bumpMap,
    material.roughnessMap,
    material.metalnessMap,
    material.emissiveMap,
    material.aoMap,
    material.alphaMap,
    material.displacementMap,
  ];
}
