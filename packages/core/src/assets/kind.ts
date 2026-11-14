/**
 * What an asset is.
 *
 * In a file of its own, below `schema.ts`, which reads the scene's types for the
 * files it describes: a field of a schema names the kind of asset it holds, the
 * component types are written in schemas, and the scene imports the component
 * types — so the kind imported from `schema.ts` would close a cycle the
 * architecture test counts.
 */
export type AssetKind =
  | 'model'
  | 'texture'
  | 'material'
  | 'physicsMaterial'
  | 'prefab'
  | 'shader'
  | 'audio'
  | 'script';
