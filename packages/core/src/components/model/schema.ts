import type { Infer, Schema } from '../../fieldSchema';
import type { Component } from '../../scene/primitives';

/** An imported model file, drawn whole or one node of it, as its fields. The order is the pane's. */
export const modelSchema = {
  /* The file it draws: chosen by dropping it into the scene, never on a row. None draws nothing. */
  assetId: { type: 'asset', label: 'Model', kind: 'model', shown: false },
  /*
   * Which node of the file this draws: `''` draws the whole thing. A path of
   * child indices from the loaded root — `'2.0.1'` — which is what lets Unpack
   * Model turn one imported file into one entity per node, each selectable,
   * transformable and given a material of its own. Unity's leaf carries a
   * `MeshFilter` pointing at a sub-asset of the model file; this is the same
   * arrangement with the same reason behind it.
   *
   * Indices rather than the name, because a name is unique in neither glTF nor
   * FBX and `clone(true)` preserves child order. The path is relative to the
   * tree as the import settings dress it — but changing those settings
   * afterwards can move a node, which is what `nodeName` is for. Neither has a
   * row: Unpack Model writes them.
   */
  nodePath: { type: 'string', label: 'Node', default: '', shown: false },
  /* The name of the node at `nodePath`, to fall back on when the tree moved. */
  nodeName: { type: 'string', label: 'Node name', default: '', shown: false },
  castShadow: { type: 'boolean', label: 'Cast shadows', default: true },
  receiveShadow: { type: 'boolean', label: 'Receive shadows', default: true },
  /*
   * A shared material drawn in place of the file's own; none keeps what the
   * file shipped with, which is what every model did before this existed —
   * "From file", not a mesh's "Embedded": a model has no material of its own to
   * fall back on. Whole-file or per node alike: an unpacked part is one node,
   * so setting it there is "this part's material", the one thing an imported
   * model had no way at all to express. The same row a mesh carries, for a
   * material asset is one, wherever it is given. No Save as Asset… beside it:
   * a model's materials live in its file, and pulling one out means decoding
   * the images it references, which is an import question.
   */
  materialId: { type: 'asset', label: 'Material', kind: 'material', emptyLabel: 'From file', separatorBefore: true },
} as const satisfies Schema;

/** An imported model file: see `modelSchema`. It names the file and the material, which the build ships. */
export type ModelComponent = Component<'model', Infer<typeof modelSchema>>;
