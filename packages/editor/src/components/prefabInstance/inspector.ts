import {
  applyInstanceOverrides,
  createPrefabVariant,
  instanceInfo,
  revertInstanceOverrides,
  selectPrefabInstances,
  unpackPrefabInstance,
} from '../../commands/prefabCommands';
import { assetSlot, type ComponentSchema } from '../../inspector/fields';
import { useAssetStore } from '../../state/assetStore';
import { usePrefabModeStore } from '../../state/prefabModeStore';

export const inspector: ComponentSchema = {
  label: 'Prefab',
  fields: [
    assetSlot(['assetId'], 'Prefab', 'prefab'),
    {
      kind: 'action',
      title: 'Open Prefab',
      // Where a change to the prefab itself is made — adding a child, or
      // overriding something a scene cannot reach because it sits two
      // prefabs deep.
      run: ({ entityId }) => {
        const info = instanceInfo(entityId);
        if (info && !info.missing) void usePrefabModeStore.getState().open(info.assetId);
      },
    },
    {
      kind: 'action',
      title: 'Create Variant…',
      run: ({ entityId }) => {
        const info = instanceInfo(entityId);
        if (info && !info.missing) void createPrefabVariant(info.assetId);
      },
    },
    {
      kind: 'action',
      title: 'Show in Project',
      run: ({ entityId }) => {
        const info = instanceInfo(entityId);
        if (info && !info.missing) useAssetStore.getState().reveal(info.assetId);
      },
    },
    {
      kind: 'action',
      // Reads the count, so pressing Apply is an informed decision rather
      // than a hope.
      title: 'Select All Instances',
      run: ({ entityId }) => selectPrefabInstances(entityId),
    },
    {
      kind: 'action',
      title: 'Apply Overrides',
      // The other half of the prefab loop: an instance is where an edit is
      // convenient to make, and this is what sends it to every other copy.
      run: ({ entityId }) => void applyInstanceOverrides(entityId),
    },
    {
      kind: 'action',
      title: 'Revert Overrides',
      run: ({ entityId }) => revertInstanceOverrides(entityId),
    },
    {
      kind: 'action',
      title: 'Unpack',
      // Unity's "Unpack Prefab": the contents become ordinary entities and
      // stop following the asset. One-way, which is why it is a button and
      // not a checkbox.
      run: ({ entityId }) => unpackPrefabInstance(entityId),
    },
  ],
};
