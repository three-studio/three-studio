import type { ComponentId, CoreRegistries, EntityId, MaterialDef } from '@three-studio/core';
import { setComponentNestedField } from '../../commands/sceneCommands';
import { extendPane } from '../../inspector/fields';
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
  registries: CoreRegistries,
  entityId: EntityId,
  componentId: ComponentId,
  material: MaterialDef,
): Promise<void> {
  const suggested = expandedScene(registries).scene.entities.get(entityId)?.name ?? 'Material';
  const name = await askForText({
    title: 'Save Material as Asset',
    label: 'Name',
    defaultValue: `${suggested} Material`,
    confirmLabel: 'Create',
  });
  if (name === null) return;

  const assetId = await useAssetStore.getState().createMaterial(registries, name, material);
  setComponentNestedField(registries, entityId, componentId, ['materialId'], assetId);
}

/**
 * A mesh's pane is derived from its fields. What it adds, after its material
 * slot: extracting the material it draws with into an asset, or copying a
 * shared one back in to edit it alone.
 */
export const pane = extendPane('mesh', {
  after: {
    materialId: [
      {
        kind: 'action',
        title: 'Save as Asset…',
        // Extraction on demand, as in Godot. Unity and Unreal are asset-first —
        // a new object gets a read-only default and any edit forces you to
        // create an asset — which is consistent but means a file per tinted
        // cube. Here the file appears when sharing is actually wanted.
        visibleWhen: (component) => component.type === 'mesh' && component.materialId === null,
        run: ({ registries, entityId, componentId, component }) => {
          if (component.type !== 'mesh') return;
          void extractMaterial(registries, entityId, componentId, component.material);
        },
      },
      {
        kind: 'action',
        title: 'Make Unique',
        visibleWhen: (component) => component.type === 'mesh' && component.materialId !== null,
        run: ({ registries, entityId, componentId, component }) => {
          if (component.type !== 'mesh' || component.materialId === null) return;
          // Copy the shared values in before unlinking, so the object keeps the
          // look it had. Detaching to whatever was embedded before would look
          // like the material was lost.
          const shared = useAssetStore.getState().materials.get(component.materialId);
          if (shared) setComponentNestedField(registries, entityId, componentId, ['material'], { ...shared });
          setComponentNestedField(registries, entityId, componentId, ['materialId'], null);
        },
      },
    ],
  },
});
