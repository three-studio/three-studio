import type { ComponentDoc, MaterialDef } from '@three-studio/core';
import { setComponentNestedField } from '../../commands/sceneCommands';
import {
  GEOMETRY_FIELDS,
  MATERIAL_FIELDS,
  type ComponentSchema,
  type FieldSpec,
} from '../../inspector/fields';
import { useAssetStore } from '../../state/assetStore';
import { askForText } from '../../state/dialogStore';
import { expandedScene } from '../../state/expansion';

/**
 * Writes the embedded material out as an asset and links the mesh to it.
 *
 * Two writes, deliberately: the file first, so a failed write leaves the mesh
 * pointing at its own material rather than at an id that does not exist.
 */
async function extractMaterial(
  entityId: string,
  componentId: string,
  material: MaterialDef,
): Promise<void> {
  const suggested = expandedScene().scene.entities[entityId]?.name ?? 'Material';
  const name = await askForText({
    title: 'Save Material as Asset',
    label: 'Name',
    defaultValue: `${suggested} Material`,
    confirmLabel: 'Create',
  });
  if (name === null) return;

  const assetId = await useAssetStore.getState().createMaterial(name, material);
  setComponentNestedField(entityId, componentId, ['materialId'], assetId);
}

export const inspector: ComponentSchema = {
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
  fields: [
    { path: ['castShadow'], label: 'Cast shadows' },
    { path: ['receiveShadow'], label: 'Receive shadows' },
    // Shape first: it is what the object *is*, and a displacement map is
    // useless without the segment counts that live here.
    { kind: 'separator' },
    { kind: 'geometry' },
    { kind: 'separator' },
    {
      path: ['materialId'],
      label: 'Material',
      params: { view: 'asset', assetKind: 'material' },
      toModel: (value) => value ?? '',
      fromModel: (value) => (value === '' ? null : value),
    },
    {
      kind: 'action',
      title: 'Save as Asset…',
      // Extraction on demand, as in Godot. Unity and Unreal are asset-first —
      // a new object gets a read-only default and any edit forces you to
      // create an asset — which is consistent but means a file per tinted
      // cube. Here the file appears when sharing is actually wanted.
      visibleWhen: (component) => component.type === 'mesh' && component.materialId === null,
      run: ({ entityId, componentId, component }) => {
        if (component.type !== 'mesh') return;
        void extractMaterial(entityId, componentId, component.material);
      },
    },
    {
      kind: 'action',
      title: 'Make Unique',
      visibleWhen: (component) => component.type === 'mesh' && component.materialId !== null,
      run: ({ entityId, componentId, component }) => {
        if (component.type !== 'mesh' || component.materialId === null) return;
        // Copy the shared values in before unlinking, so the object keeps the
        // look it had. Detaching to whatever was embedded before would look
        // like the material was lost.
        const shared = useAssetStore.getState().materials[component.materialId];
        if (shared) setComponentNestedField(entityId, componentId, ['material'], { ...shared });
        setComponentNestedField(entityId, componentId, ['materialId'], null);
      },
    },
    ...MATERIAL_FIELDS,
  ],
};

/**
 * What the `{ kind: 'geometry' }` slot expands into: the fields of whichever
 * primitive this mesh is.
 *
 * Looked up rather than declared, because the list itself changes with the
 * kind — which is what `paneKey` is for.
 */
export function geometryFields(component: ComponentDoc): readonly FieldSpec[] {
  if (component.type !== 'mesh') return [];
  return GEOMETRY_FIELDS[component.geometry.kind];
}
