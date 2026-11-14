import type { CoreRegistries } from '../../registries';
import type { AssetKind, AssetSettings } from '../schema';
import type { AssetImporter } from './AssetImporter';

export { AssetImporter, type TextReader } from './AssetImporter';
export { ModelImporter, FIT_TO_METRE } from './importers/ModelImporter';
export * from './session';

/*
 * What the registered importers answer about a file, asked of the registries a
 * caller was handed.
 *
 * A chain of responsibility rather than a lookup table, because the question
 * "what is this file" has ties that a table cannot express: `.material.json`
 * and `.prefab.json` are both `.json`, and `.material.ts` is also `.ts`. The
 * first registered importer that claims a file takes it, so the order the core's
 * activation registers them in is the whole answer — see `registries.ts`. The
 * version before that resolved the ties by whichever key `Object.entries`
 * happened to return first, which is a real answer arrived at by accident.
 */

/** The first registered importer that claims the file; `undefined` when none does. */
export function importerForFile(registries: CoreRegistries, fileName: string): AssetImporter | undefined {
  return registries.importers.values().find((importer) => importer.claims(fileName));
}

/**
 * The importer a kind falls back to when there is no file name to go on.
 *
 * `defaultSettings('model')` with nothing else has to answer something, and
 * the first registered importer of the kind is the honest choice — for models
 * that is glTF, which is the format to author against anyway.
 */
export function importerForKind(registries: CoreRegistries, kind: AssetKind): AssetImporter | undefined {
  return registries.importers.values().find((importer) => importer.kind === kind);
}

/** `undefined` when the extension is not something the editor can import. */
export function assetKindForFile(registries: CoreRegistries, fileName: string): AssetKind | undefined {
  return importerForFile(registries, fileName)?.kind;
}

/** Every double extension any registered importer claims, longest first. */
export function importSuffixes(registries: CoreRegistries): readonly string[] {
  return registries.importers
    .values()
    .flatMap((importer) => importer.suffixes)
    .sort((a, b) => b.length - a.length);
}

/**
 * Display name for an asset file.
 *
 * Strips the whole compound extension, so `Brick.material.json` reads as
 * `Brick` rather than `Brick.material` — the kind is already a column.
 */
export function assetDisplayName(registries: CoreRegistries, fileName: string): string {
  const lower = fileName.toLowerCase();
  for (const suffix of importSuffixes(registries)) {
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
export function defaultSettings(registries: CoreRegistries, kind: AssetKind, fileName = ''): AssetSettings {
  const claimed = importerForFile(registries, fileName);
  const importer = claimed?.kind === kind ? claimed : importerForKind(registries, kind);
  if (importer === undefined) {
    throw new Error(`No importer registered for asset kind: ${kind}`);
  }
  return importer.defaultSettings(fileName);
}

/** Where a kind is filed under `assets/`, and every extension it accepts. */
export interface AssetKindInfo {
  readonly directory: string;
  readonly extensions: readonly string[];
}

/**
 * Every kind the registered importers claim, in the order the first importer
 * of each is registered.
 *
 * A kind no registered importer claims is absent rather than typed present: a
 * caller that needs one kind reads it through `assertDefined`, which names it
 * when it is missing.
 */
export function assetKindInfo(registries: CoreRegistries): ReadonlyMap<AssetKind, AssetKindInfo> {
  const info = new Map<AssetKind, { directory: string; extensions: string[] }>();
  for (const importer of registries.importers.values()) {
    const entry = info.get(importer.kind) ?? { directory: importer.directory, extensions: [] };
    info.set(importer.kind, entry);
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
