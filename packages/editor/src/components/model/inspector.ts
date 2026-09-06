import { unpackModel } from '../../commands/modelCommands';
import { assetSlot, type ComponentSchema } from '../../inspector/fields';

export const inspector: ComponentSchema = {
  label: 'Model',
  fields: [
    { path: ['castShadow'], label: 'Cast shadows' },
    { path: ['receiveShadow'], label: 'Receive shadows' },
    { kind: 'separator' },
    {
      /*
       * The one thing an imported model had no way at all to express.
       *
       * The same row `mesh` carries, and deliberately so: a material asset is
       * a material asset, and the author should not have to learn that giving
       * one to a cube and giving one to a chair are different gestures. Empty
       * keeps the materials the file shipped with, which is what every model
       * did before this existed.
       *
       * There is no "Save as Asset…" beside it, unlike `mesh`. A model has no
       * embedded `MaterialDef` to extract — its materials live inside the
       * file, and pulling one out means decoding the images it references,
       * which is an import question rather than an inspector one.
       */
      // "From file", not the mesh's "Embedded": a model has no embedded
      // `MaterialDef` to fall back on, it has whatever the glTF shipped with.
      ...assetSlot(['materialId'], 'Material', 'material', 'From file'),
    },
    { kind: 'separator' },
    {
      kind: 'action',
      title: 'Unpack Model',
      // Unity's "Unpack Prefab", for a file: one entity per node, each of them
      // movable, hideable and re-materialable on its own. One-way, which is
      // why it is a button and not a checkbox — and offered only on the entity
      // that still draws the whole thing.
      visibleWhen: (component) => component.type === 'model' && component.nodePath === '',
      run: ({ entityId }) => void unpackModel(entityId),
    },
  ],
};
