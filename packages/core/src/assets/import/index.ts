import type { AssetKind, AssetSettings } from '../schema';
import type { AssetImporter } from './AssetImporter';
import { ImporterRegistry } from './ImporterRegistry';
import { FbxImporter } from './importers/FbxImporter';
import { GltfImporter } from './importers/GltfImporter';
import { ObjImporter } from './importers/ObjImporter';
import { TextureImporter } from './importers/TextureImporter';
import { AudioImporter } from './importers/AudioImporter';
import {
  MaterialImporter,
  PrefabImporter,
  ScriptImporter,
  ShaderImporter,
} from './importers/dataImporters';

export { AssetImporter, type TextReader } from './AssetImporter';
export { ImporterRegistry } from './ImporterRegistry';
export { ModelImporter, FIT_TO_METRE } from './importers/ModelImporter';
export * from './ImportField';
export * from './session';

/**
 * The registry, in the order ties are resolved.
 *
 * Ambiguity lives entirely at the top of this list, so it is worth reading as
 * an ordering rather than as a set:
 *
 *   * `.prefab.json` before `.material.*`, or a prefab would be a material.
 *   * `.material.ts` before `.ts`, or a TSL material would be a script.
 *   * a bare `.json` falls through to the material importer, which is where it
 *     landed before this list existed and where it must keep landing.
 */
export const importers = new ImporterRegistry().register(
  new PrefabImporter(),
  new MaterialImporter(),
  new ScriptImporter(),
  new GltfImporter(),
  new FbxImporter(),
  new ObjImporter(),
  new TextureImporter(),
  new AudioImporter(),
  new ShaderImporter(),
);

/** `undefined` when nothing in the registry claims the file. */
export function importerForFile(fileName: string): AssetImporter | undefined {
  return importers.resolve(fileName);
}

/** `undefined` when the extension is not something the editor can import. */
export function assetKindForFile(fileName: string): AssetKind | undefined {
  return importers.resolve(fileName)?.kind;
}

/**
 * Display name for an asset file.
 *
 * Strips the whole compound extension, so `Brick.material.json` reads as
 * `Brick` rather than `Brick.material` — the kind is already a column.
 */
export function assetDisplayName(fileName: string): string {
  const lower = fileName.toLowerCase();
  for (const suffix of importers.suffixes()) {
    if (lower.endsWith(suffix)) return fileName.slice(0, -suffix.length);
  }
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

/**
 * The settings a file starts with.
 *
 * Takes the kind as well as the name because its callers have one and not
 * always the other: a sidecar being upgraded knows the kind it was written as,
 * and the name only says which *format* within that kind. When the two
 * disagree — a `.png` in a sidecar tagged `model` — the stored kind wins, since
 * the author may have retagged it deliberately.
 */
export function defaultSettings(kind: AssetKind, fileName = ''): AssetSettings {
  const claimed = importers.resolve(fileName);
  const importer = claimed?.kind === kind ? claimed : importers.forKind(kind);
  if (importer === undefined) {
    throw new Error(`No importer registered for asset kind: ${kind}`);
  }
  return importer.defaultSettings(fileName);
}

/** Where each kind is filed under `assets/`, and every extension it accepts. */
export const ASSET_KIND_INFO: Record<
  AssetKind,
  { directory: string; extensions: readonly string[] }
> = buildKindInfo();

function buildKindInfo(): Record<AssetKind, { directory: string; extensions: readonly string[] }> {
  const info = {} as Record<AssetKind, { directory: string; extensions: string[] }>;

  for (const importer of importers.all()) {
    const entry = (info[importer.kind] ??= { directory: importer.directory, extensions: [] });
    for (const extension of importer.extensions) {
      if (!entry.extensions.includes(extension)) entry.extensions.push(extension);
    }
    // A kind whose importers only claim double extensions would otherwise offer
    // nothing to a file dialog: `.prefab.json` is still a `.json` to one.
    for (const suffix of importer.suffixes) {
      const extension = suffix.slice(suffix.lastIndexOf('.') + 1);
      if (!entry.extensions.includes(extension)) entry.extensions.push(extension);
    }
  }
  return info;
}
