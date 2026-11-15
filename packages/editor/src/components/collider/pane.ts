import {
  createPhysicsSettings,
  linkedPhysicsMaterial,
  type ComponentId,
  type CoreRegistries,
  type EntityId,
  type PhysicsMaterialDef,
} from '@three-studio/core';
import { fitColliderToMesh, setComponentNestedField } from '../../commands/sceneCommands';
import { extendPane } from '../../inspector/fields';
import { useAssetStore } from '../../state/assetStore';
import { askForText } from '../../state/dialogStore';
import { expandedScene } from '../../state/expansion';
import { useProjectStore } from '../../state/projectStore';
import { peekViewport } from '../../viewport/viewportHost';

/**
 * Writes the collider's own values out as a physics material and links it, as
 * a mesh's *Save as Asset…* does: the file first, so a failed write leaves the
 * collider on its own values rather than linked to an id that does not exist.
 */
async function extractPhysicsMaterial(
  registries: CoreRegistries,
  entityId: EntityId,
  componentId: ComponentId,
  material: PhysicsMaterialDef,
): Promise<void> {
  const suggested = expandedScene(registries).scene.entities.get(entityId)?.name ?? 'Collider';
  const name = await askForText({
    title: 'Save Physics Material as Asset',
    label: 'Name',
    defaultValue: `${suggested} Physics Material`,
    confirmLabel: 'Create',
  });
  if (name === null) return;

  const assetId = await useAssetStore.getState().createPhysicsMaterial(registries, name, material);
  setComponentNestedField(registries, entityId, componentId, ['materialId'], assetId);
}

/**
 * A collider's pane is derived from its fields. What it adds: fitting its shape
 * to the meshes it rides, the project's layers to choose its own from, and
 * saving its material as an asset or copying a shared one back in.
 */
export const pane = extendPane('collider', {
  after: {
    shape: [
      {
        kind: 'action',
        title: 'Fit to Mesh',
        // A mesh collider is its meshes already.
        visibleWhen: (component) => component.type === 'collider' && component.shape.kind !== 'mesh',
        // The edit view's binder: the meshes as it draws them.
        run: ({ registries, entityId, componentId }) => {
          const binder = peekViewport()?.binder;
          if (binder) fitColliderToMesh(registries, entityId, componentId, binder);
        },
      },
    ],
    // While linked, the rows below show the asset's values and edit its file,
    // for every collider linking it; the collider's own are kept.
    materialId: [
      {
        kind: 'action',
        title: 'Save as Asset…',
        visibleWhen: (component) => component.type === 'collider' && component.materialId === null,
        run: ({ registries, entityId, componentId, component }) => {
          if (component.type !== 'collider') return;
          void extractPhysicsMaterial(registries, entityId, componentId, component.material);
        },
      },
      {
        kind: 'action',
        title: 'Make Unique',
        visibleWhen: (component) => component.type === 'collider' && component.materialId !== null,
        run: ({ registries, entityId, componentId, component }) => {
          if (component.type !== 'collider' || component.materialId === null) return;
          // The shared values copied in before unlinking, so the collider grips
          // as it did. A link the project cannot answer played its own already.
          const { physicsMaterials } = useAssetStore.getState();
          const shared = linkedPhysicsMaterial(component.materialId, physicsMaterials);
          if (shared) setComponentNestedField(registries, entityId, componentId, ['material'], { ...shared });
          setComponentNestedField(registries, entityId, componentId, ['materialId'], null);
        },
      },
    ],
  },
  drawers: {
    // Read when the pane is built, which the Inspector does again when the
    // table changes. A layer the project no longer has is no choice at all: the
    // list selects nothing, and Play says what it collides as meanwhile.
    layer: (row) =>
      row === null
        ? []
        : [
            {
              ...row,
              optionsProvider: () => {
                const layers =
                  useProjectStore.getState().project?.settings.physics.layers ?? createPhysicsSettings().layers;
                return Object.fromEntries(layers.map((layer) => [layer.name, layer.id]));
              },
            },
          ],
  },
});
