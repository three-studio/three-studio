import { createGeometry, createMaterial, createMeshComponent } from '../scene/defaults';
import { materialAssets } from './materialAssets';
import { defineComponent } from './registry';

/**
 * A renderable primitive and the material it draws with.
 *
 * The one type whose fill is not a shallow spread. Its material and geometry are
 * objects of their own, and a scene written before texture slots existed needs
 * them merged a level deeper — leaving `undefined` where three expects a value is
 * what shipped twice before `fillMissingFields` was written.
 */
export const meshComponent = defineComponent({
  type: 'mesh',
  create: () => createMeshComponent('box'),
  fill: (stored) => {
    const filled = { ...createMeshComponent('box'), ...stored };
    filled.material = { ...createMaterial(), ...filled.material };
    filled.materialId ??= null;
    filled.geometry = { ...createGeometry(filled.geometry.kind), ...filled.geometry };
    return filled;
  },
  assets: (component) => [component.materialId, ...materialAssets(component.material)],
  icon: 'shapes',
  runtime: true,
});
