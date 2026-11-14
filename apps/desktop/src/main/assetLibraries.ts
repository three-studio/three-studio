import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { posix } from 'node:path';
import {
  ASSETS_DIR,
  ASSET_META_VERSION,
  MATERIAL_ASSET_VERSION,
  PHYSICS_MATERIAL_ASSET_VERSION,
  assertDefined,
  assetKindInfo,
  conformPhysicsMaterial,
  createAssetId,
  createMaterial,
  defaultSettings,
  deserializePrefab,
  isRecord,
  safeFileName,
  serializePrefab,
  stableJson,
  type AssetId,
  type AssetManifest,
  type AssetMeta,
  type CoreRegistries,
  type MaterialDef,
  type PhysicsMaterialDef,
  type PrefabDoc,
} from '@three-studio/core';
import { resolveInside } from './paths';
import { AssetError, hashFile, uniqueFileName } from './assetFiles';
import { readAssetMeta, scanAssets, writeAssetMeta } from './assetScan';

/*
 * The three asset kinds the editor writes as well as reads: materials, physics
 * materials and prefabs.
 *
 * All three are JSON documents of ours rather than files someone imported, so
 * each has a format version, a migration on read, and a write that has to keep
 * the sidecar's hash in step with the bytes. A material and a physics material
 * are both filed as `{ version, material }`, so one set of rules reads and
 * writes either; a prefab's file is the document itself.
 */

const PREFAB_EXTENSION = '.prefab.json';

/** Where a kind's files go under `assets/`: its importers' directory, which every kind written here has. */
function directoryOf(registries: CoreRegistries, kind: 'prefab' | 'material' | 'physicsMaterial'): string {
  return posix.join(ASSETS_DIR, assertDefined(assetKindInfo(registries).get(kind), `the ${kind} kind`).directory);
}

/** What tells one `{ version, material }` kind from the other. */
interface MaterialLibrary<T> {
  kind: 'material' | 'physicsMaterial';
  suffix: string;
  version: number;
  /** The stored `material`, filled where it predates a field. */
  read: (stored: unknown) => T;
  /**
   * What one is called: the file's name when the one asked for keeps no
   * character, and the noun of a refused save.
   */
  name: string;
}

const MATERIALS: MaterialLibrary<MaterialDef> = {
  kind: 'material',
  suffix: '.material.json',
  version: MATERIAL_ASSET_VERSION,
  // Filled the same way scenes are: a material written before a property
  // existed would otherwise hand `undefined` to three and to the inspector,
  // and Tweakpane cannot build a control for that — it throws and takes the
  // whole panel with it.
  read: (stored) => ({ ...createMaterial(), ...(isRecord(stored) ? stored : {}) }),
  name: 'Material',
};

const PHYSICS_MATERIALS: MaterialLibrary<PhysicsMaterialDef> = {
  kind: 'physicsMaterial',
  suffix: '.physics-material.json',
  version: PHYSICS_MATERIAL_ASSET_VERSION,
  read: conformPhysicsMaterial,
  name: 'Physics Material',
};

/**
 * Every prefab in the project, keyed by asset id.
 *
 * Read in one pass for the same reason materials are: the binder expands an
 * instance synchronously, and a prefab fetched per reference would leave a
 * hole in the scene for a frame.
 *
 * Each is read under its sidecar's id, whatever its own file says: a prefab is
 * an asset, and the sidecar is where an asset's id lives.
 */
/**
 * @param scanned A manifest the caller already has. A scan walks the tree and
 *   writes any sidecar that is missing or out of date, so running several at
 *   once is both wasteful and a race — see `writeAssetMeta`. Callers that need
 *   more than one of these read the tree once and pass it here.
 */
export async function readPrefabAssets(
  registries: CoreRegistries,
  projectPath: string,
  scanned?: AssetManifest,
): Promise<Map<AssetId, PrefabDoc>> {
  const manifest = scanned ?? (await scanAssets(registries, projectPath));
  const prefabs = new Map<AssetId, PrefabDoc>();

  await Promise.all(
    manifest.assets
      .filter((asset) => asset.kind === 'prefab' && asset.path.endsWith(PREFAB_EXTENSION))
      .map(async (asset) => {
        try {
          const text = await readFile(resolveInside(projectPath, asset.path), 'utf8');
          prefabs.set(asset.id, deserializePrefab(registries, text, asset.id));
        } catch {
          // Left out: a prefab that cannot be read, or one of another format,
          // which nothing converts. One must not cost the others; the instances
          // that point at it render empty and say so.
        }
      }),
  );

  return prefabs;
}

/** Writes a new prefab asset and its sidecar; returns the new asset id. */
export async function createPrefabAsset(
  registries: CoreRegistries,
  projectPath: string,
  name: string,
  prefab: PrefabDoc,
  /**
   * Reuses an id instead of taking the prefab's own, for redoing a creation that
   * undo took back. A fresh id would leave the entity — restored by the undo
   * patches — pointing at a prefab that no longer answers to that name.
   */
  assetId?: AssetId,
): Promise<AssetId> {
  const directory = directoryOf(registries, 'prefab');
  await mkdir(resolveInside(projectPath, directory), { recursive: true });

  const safe = safeFileName(name) || 'Prefab';
  const fileName = await uniqueFileName(
    projectPath,
    directory,
    `${safe}${PREFAB_EXTENSION}`,
    PREFAB_EXTENSION,
  );
  const file = resolveInside(projectPath, posix.join(directory, fileName));
  // The sidecar and the file say the same id, which they did not: the document
  // was minted one and the sidecar another, and only the sidecar's was ever read.
  const id = assetId ?? prefab.id;
  await writeFile(file, serializePrefab(registries, { ...prefab, id }), 'utf8');

  const meta: AssetMeta = {
    version: ASSET_META_VERSION,
    id,
    kind: 'prefab',
    importedAt: Date.now(),
    hash: await hashFile(file),
    settings: defaultSettings(registries, 'prefab', fileName),
  };
  await writeAssetMeta(file, meta);
  return meta.id;
}

/**
 * Every document of a library's kind, keyed by asset id.
 *
 * Read in one pass because the binder builds meshes synchronously: a material
 * fetched per reference would leave the mesh untextured for a frame, and a
 * scene with a hundred of them would do a hundred round trips.
 */
async function readLibrary<T>(
  registries: CoreRegistries,
  library: MaterialLibrary<T>,
  projectPath: string,
  scanned: AssetManifest | undefined,
): Promise<Map<AssetId, T>> {
  const manifest = scanned ?? (await scanAssets(registries, projectPath));
  const documents = new Map<AssetId, T>();

  await Promise.all(
    manifest.assets
      .filter((asset) => asset.kind === library.kind && asset.path.endsWith(library.suffix))
      .map(async (asset) => {
        try {
          const file: unknown = JSON.parse(
            await readFile(resolveInside(projectPath, asset.path), 'utf8'),
          );
          if (!isRecord(file)) return;
          // One written by a newer build may use parameters this one would
          // silently drop, so it is left out rather than half-applied.
          const version = file['version'];
          if (typeof version === 'number' && version > library.version) return;
          documents.set(asset.id, library.read(file['material']));
        } catch {
          // A corrupt file must not stop the others from loading; what links
          // to it falls back to its embedded value.
        }
      }),
  );

  return documents;
}

/** Writes a new document of a library's kind and its sidecar; returns the new asset id. */
async function createInLibrary<T>(
  registries: CoreRegistries,
  library: MaterialLibrary<T>,
  projectPath: string,
  name: string,
  material: T,
): Promise<AssetId> {
  const directory = directoryOf(registries, library.kind);
  await mkdir(resolveInside(projectPath, directory), { recursive: true });

  const safe = safeFileName(name) || library.name;
  const fileName = await uniqueFileName(
    projectPath,
    directory,
    `${safe}${library.suffix}`,
    library.suffix,
  );
  const file = resolveInside(projectPath, posix.join(directory, fileName));
  await writeFile(file, stableJson({ version: library.version, material }), 'utf8');

  // The sidecar carries the id every scene will reference, so it is written
  // here rather than left to the next scan to invent.
  const meta: AssetMeta = {
    version: ASSET_META_VERSION,
    id: createAssetId(),
    kind: library.kind,
    importedAt: Date.now(),
    hash: await hashFile(file),
    settings: defaultSettings(registries, library.kind, fileName),
  };
  await writeAssetMeta(file, meta);
  return meta.id;
}

/** Overwrites an existing document of a library's kind in place, keeping its id. */
async function saveInLibrary<T>(
  registries: CoreRegistries,
  library: MaterialLibrary<T>,
  projectPath: string,
  assetPath: string,
  material: T,
): Promise<void> {
  const file = resolveInside(projectPath, assetPath);
  if (!file.endsWith(library.suffix)) {
    throw new AssetError(`${assetPath} is not a ${library.name.toLowerCase()} asset.`);
  }

  await writeFile(file, stableJson({ version: library.version, material }), 'utf8');

  // The hash names the content, so leaving it stale would make a later
  // duplicate check compare against a file that no longer exists.
  const meta = await readAssetMeta(registries, file);
  if (meta) await writeAssetMeta(file, { ...meta, hash: await hashFile(file) });
}

/**
 * Every preset material in the project, keyed by asset id.
 *
 * @param scanned See `readPrefabAssets`.
 */
export function readMaterialAssets(
  registries: CoreRegistries,
  projectPath: string,
  scanned?: AssetManifest,
): Promise<Map<AssetId, MaterialDef>> {
  return readLibrary(registries, MATERIALS, projectPath, scanned);
}

export function createMaterialAsset(
  registries: CoreRegistries,
  projectPath: string,
  name: string,
  material: MaterialDef,
): Promise<AssetId> {
  return createInLibrary(registries, MATERIALS, projectPath, name, material);
}

export function saveMaterialAsset(
  registries: CoreRegistries,
  projectPath: string,
  assetPath: string,
  material: MaterialDef,
): Promise<void> {
  return saveInLibrary(registries, MATERIALS, projectPath, assetPath, material);
}

/**
 * Every physics material in the project, keyed by asset id, read against its
 * factory.
 *
 * @param scanned See `readPrefabAssets`.
 */
export function readPhysicsMaterialAssets(
  registries: CoreRegistries,
  projectPath: string,
  scanned?: AssetManifest,
): Promise<Map<AssetId, PhysicsMaterialDef>> {
  return readLibrary(registries, PHYSICS_MATERIALS, projectPath, scanned);
}

export function createPhysicsMaterialAsset(
  registries: CoreRegistries,
  projectPath: string,
  name: string,
  material: PhysicsMaterialDef,
): Promise<AssetId> {
  return createInLibrary(registries, PHYSICS_MATERIALS, projectPath, name, material);
}

export function savePhysicsMaterialAsset(
  registries: CoreRegistries,
  projectPath: string,
  assetPath: string,
  material: PhysicsMaterialDef,
): Promise<void> {
  return saveInLibrary(registries, PHYSICS_MATERIALS, projectPath, assetPath, material);
}

/**
 * Overwrites a prefab asset in place, for "apply overrides".
 *
 * Deliberately separate from `createPrefabAsset`: creating picks a free file
 * name, and reusing that here would leave every instance pointing at the file
 * the edit did not go into.
 */
export async function savePrefabAsset(
  registries: CoreRegistries,
  projectPath: string,
  assetPath: string,
  prefab: PrefabDoc,
): Promise<void> {
  const file = resolveInside(projectPath, assetPath);
  if (!file.endsWith(PREFAB_EXTENSION)) {
    throw new AssetError(`${assetPath} is not a prefab asset.`);
  }

  await writeFile(file, serializePrefab(registries, prefab), 'utf8');

  // The hash names the content, so leaving it stale would make a later
  // duplicate check compare against a file that no longer exists.
  const meta = await readAssetMeta(registries, file);
  if (meta) await writeAssetMeta(file, { ...meta, hash: await hashFile(file) });
}

/** Rejects the characters a folder name cannot carry across platforms. */
