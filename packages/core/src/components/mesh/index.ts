import { createGeometry } from '../../scene/geometry';
import { createMaterial } from '../../scene/material';
import { materialAssets } from '../materialAssets';
import type { ComponentDefinition } from '../registry';
import { createMeshComponent } from './defaults';
import type { MeshComponent } from './schema';

/**
 * A renderable primitive and the material it draws with.
 *
 * The one type whose fill is not a shallow spread. Its material and geometry are
 * objects of their own, and a scene written before texture slots existed needs
 * them merged a level deeper — leaving `undefined` where three expects a value is
 * what shipped twice before `fillMissingFields` was written.
 */
export const meshComponent: ComponentDefinition<MeshComponent> = {
  id: 'mesh',
  /*
   * Not "Mesh Renderer", which is what it said and what it is not.
   *
   * Unity's MeshRenderer draws whatever a MeshFilter points at; this owns a
   * `GeometryDef`, and `GeometryDef` is thirteen primitives with no way to
   * name a file. So "Add Component ▸ Mesh Renderer" on an imported model read
   * as "give this model a material" and produced a grey 1×1×1 box beside it —
   * correct behaviour of a name that promised something else. Giving a model a
   * material is `model`'s own row now, and this is a primitive again.
   */
  label: 'Mesh',
  create: () => createMeshComponent('box'),
  fill: (stored) => {
    const filled = { ...createMeshComponent('box'), ...stored };
    filled.material = { ...createMaterial(), ...filled.material };
    filled.materialId ??= null;
    filled.geometry = { ...createGeometry(filled.geometry.kind), ...filled.geometry };
    return filled;
  },
  assets: (component) => [component.materialId, ...materialAssets(component.material)],
  entities: () => [],
  placeable: () => true,
  runtime: true,
  addable: true,
};
