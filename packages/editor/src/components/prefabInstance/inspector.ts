import { instanceInfo } from '../../commands/prefabCommands';
import { commandById, contextFor, contextForAsset } from '../../commands/registry';
import { assetSlot, type ComponentSchema } from '../../inspector/fields';
import { usePrefabModeStore } from '../../state/prefabModeStore';

/*
 * Every action here that the hierarchy's context menu also offers goes through
 * the registry, and that is what stopped the two disagreeing: Apply and Revert
 * Overrides were live buttons here while the hierarchy greyed them on an
 * instance with no overrides, and Show in Project was live while the hierarchy
 * greyed it on a missing prefab. Pressing any of those did nothing.
 *
 * The buttons are still not *drawn* greyed — Tweakpane builds each one once, and
 * keeping its enabled state current would mean subscribing the Inspector to
 * every mutation, which is exactly what T-057 measured and refused. What they no
 * longer do is disagree about the outcome: `run` re-checks `can()`. Recorded in
 * `RESTES.md`.
 */

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
      run: ({ entityId }) => commandById('createPrefabVariant').run(contextFor([entityId])),
    },
    {
      kind: 'action',
      title: 'Show in Project',
      run: ({ entityId }) => {
        const info = instanceInfo(entityId);
        if (info) commandById('revealAsset').run(contextForAsset(info.assetId));
      },
    },
    {
      kind: 'action',
      // Reads the count, so pressing Apply is an informed decision rather
      // than a hope.
      title: 'Select All Instances',
      run: ({ entityId }) => commandById('selectPrefabInstances').run(contextFor([entityId])),
    },
    {
      kind: 'action',
      title: 'Apply Overrides',
      // The other half of the prefab loop: an instance is where an edit is
      // convenient to make, and this is what sends it to every other copy.
      run: ({ entityId }) => commandById('applyPrefabOverrides').run(contextFor([entityId])),
    },
    {
      kind: 'action',
      title: 'Revert Overrides',
      run: ({ entityId }) => commandById('revertPrefabOverrides').run(contextFor([entityId])),
    },
    {
      kind: 'action',
      title: 'Unpack',
      // Unity's "Unpack Prefab": the contents become ordinary entities and
      // stop following the asset. One-way, which is why it is a button and
      // not a checkbox.
      run: ({ entityId }) => commandById('unpackPrefab').run(contextFor([entityId])),
    },
  ],
};
