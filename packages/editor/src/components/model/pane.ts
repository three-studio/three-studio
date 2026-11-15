import { commandById, contextFor } from '../../commands/registry';
import { extendPane } from '../../inspector/fields';

/**
 * A model's pane is derived from its fields: its shadows, then its material —
 * "From file", not the mesh's "Embedded", since a model has no embedded
 * material to fall back on, it has whatever the glTF shipped with. Its file and
 * its node are what the drop and the unpack wrote, and have no row.
 *
 * There is no "Save as Asset…" beside the material, unlike `mesh`. A model has
 * no embedded `MaterialDef` to extract — its materials live inside the file,
 * and pulling one out means decoding the images it references, which is an
 * import question rather than an inspector one.
 *
 * What it adds, after its material, is unpacking it.
 */
export const pane = extendPane('model', {
  after: {
    materialId: [
      { kind: 'separator' },
      {
        kind: 'action',
        title: 'Unpack Model',
        // Unity's "Unpack Prefab", for a file: one entity per node, each of
        // them movable, hideable and re-materialable on its own. One-way, which
        // is why it is a button and not a checkbox — and offered only on the
        // entity that still draws the whole thing.
        visibleWhen: (component) => component.type === 'model' && component.nodePath === '',
        // Through its command, as the prefab instance's actions go: calling
        // `unpackModel` here went past the command's `can()`, so neither the
        // padlock nor the scene lock was ever asked.
        run: ({ registries, entityId }) => commandById('unpackModel').run(contextFor(registries, [entityId])),
      },
    ],
  },
});
