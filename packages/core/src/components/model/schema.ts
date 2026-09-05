import type { ComponentBase } from '../../scene/primitives';

/** An imported glTF. References an asset id so instancing stays possible later. */
export interface ModelComponent extends ComponentBase {
  type: 'model';
  assetId: string;
  /**
   * Which node of the file this draws. `''` draws the whole thing.
   *
   * A path of child indices from the loaded root — `'2.0.1'` — which is what
   * lets `unpackModel` turn one imported file into one entity per node, each
   * selectable, transformable and given a material of its own. Unity's leaf
   * carries a `MeshFilter` pointing at a sub-asset of the model file; this is
   * the same arrangement with the same reason behind it.
   *
   * Indices rather than the name, because a name is unique in neither glTF nor
   * FBX and `clone(true)` preserves child order. The path is relative to the
   * tree **as the import settings dress it**, which both the unpack and the
   * runtime see because both go through `ModelCache` — but changing those
   * settings afterwards can move a node, which is what `nodeName` is for.
   */
  nodePath: string;
  /** The name of the node at `nodePath`, to fall back on when the tree moved. */
  nodeName: string;
  /**
   * Asset id of a shared material drawn in place of the file's own.
   *
   * `null` keeps what the file shipped with, which is what every model did
   * before this existed. Whole-file or per-node alike: an unpacked part is one
   * node, so setting it there is "this part's material" — the one thing an
   * imported model had no way at all to express.
   */
  materialId: string | null;
  castShadow: boolean;
  receiveShadow: boolean;
}
