import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { posix } from 'node:path';
import {
  ASSETS_DIR,
  ASSET_KIND_INFO,
  ASSET_META_VERSION,
  MATERIAL_ASSET_VERSION,
  PHYSICS_MATERIAL_ASSET_VERSION,
  PREFAB_FORMAT_VERSION,
  conformPhysicsMaterial,
  createId,
  createMaterial,
  defaultSettings,
  isRecord,
  safeFileName,
  stableJson,
  type AssetManifest,
  type AssetMeta,
  migratePrefab,
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
 */
/**
 * @param scanned A manifest the caller already has. A scan walks the tree and
 *   writes any sidecar that is missing or out of date, so running several at
 *   once is both wasteful and a race — see `writeAssetMeta`. Callers that need
 *   more than one of these read the tree once and pass it here.
 */
export async function readPrefabAssets(
  projectPath: string,
  scanned?: AssetManifest,
): Promise<Record<string, PrefabDoc>> {
  const manifest = scanned ?? (await scanAssets(projectPath));
  const prefabs: Record<string, PrefabDoc> = {};

  await Promise.all(
    manifest.assets
      .filter((asset) => asset.kind === 'prefab' && asset.path.endsWith(PREFAB_EXTENSION))
      .map(async (asset) => {
        try {
          const parsed = JSON.parse(
            await readFile(resolveInside(projectPath, asset.path), 'utf8'),
          ) as PrefabDoc;
          if (parsed.version > PREFAB_FORMAT_VERSION) return;
          prefabs[asset.id] = migratePrefab(parsed);
        } catch {
          // One unreadable prefab must not cost the others; the instances that
          // point at it render empty and say so.
        }
      }),
  );

  return prefabs;
}

/** Writes a new prefab asset and its sidecar; returns the new asset id. */
export async function createPrefabAsset(
  projectPath: string,
  name: string,
  prefab: PrefabDoc,
  /**
   * Reuses an id instead of minting one, for redoing a creation that undo took
   * back. A fresh id would leave the entity — restored by the undo patches —
   * pointing at a prefab that no longer answers to that name.
   */
  assetId?: string,
): Promise<string> {
  const directory = posix.join(ASSETS_DIR, ASSET_KIND_INFO.prefab.directory);
  await mkdir(resolveInside(projectPath, directory), { recursive: true });

  const safe = safeFileName(name) || 'Prefab';
  const fileName = await uniqueFileName(
    projectPath,
    directory,
    `${safe}${PREFAB_EXTENSION}`,
    PREFAB_EXTENSION,
  );
  const file = resolveInside(projectPath, posix.join(directory, fileName));
  await writeFile(file, stableJson(prefab), 'utf8');

  const meta: AssetMeta = {
    version: ASSET_META_VERSION,
    id: assetId ?? createId(),
    kind: 'prefab',
    importedAt: Date.now(),
    hash: await hashFile(file),
    settings: defaultSettings('prefab', fileName),
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
  library: MaterialLibrary<T>,
  projectPath: string,
  scanned: AssetManifest | undefined,
): Promise<Record<string, T>> {
  const manifest = scanned ?? (await scanAssets(projectPath));
  const documents: Record<string, T> = {};

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
          documents[asset.id] = library.read(file['material']);
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
  library: MaterialLibrary<T>,
  projectPath: string,
  name: string,
  material: T,
): Promise<string> {
  const directory = posix.join(ASSETS_DIR, ASSET_KIND_INFO[library.kind].directory);
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
    id: createId(),
    kind: library.kind,
    importedAt: Date.now(),
    hash: await hashFile(file),
    settings: defaultSettings(library.kind, fileName),
  };
  await writeAssetMeta(file, meta);
  return meta.id;
}

/** Overwrites an existing document of a library's kind in place, keeping its id. */
async function saveInLibrary<T>(
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
  const meta = await readAssetMeta(file);
  if (meta) await writeAssetMeta(file, { ...meta, hash: await hashFile(file) });
}

/**
 * Every preset material in the project, keyed by asset id.
 *
 * @param scanned See `readPrefabAssets`.
 */
export function readMaterialAssets(
  projectPath: string,
  scanned?: AssetManifest,
): Promise<Record<string, MaterialDef>> {
  return readLibrary(MATERIALS, projectPath, scanned);
}

export function createMaterialAsset(
  projectPath: string,
  name: string,
  material: MaterialDef,
): Promise<string> {
  return createInLibrary(MATERIALS, projectPath, name, material);
}

export function saveMaterialAsset(
  projectPath: string,
  assetPath: string,
  material: MaterialDef,
): Promise<void> {
  return saveInLibrary(MATERIALS, projectPath, assetPath, material);
}

/**
 * Every physics material in the project, keyed by asset id, read against its
 * factory.
 *
 * @param scanned See `readPrefabAssets`.
 */
export function readPhysicsMaterialAssets(
  projectPath: string,
  scanned?: AssetManifest,
): Promise<Record<string, PhysicsMaterialDef>> {
  return readLibrary(PHYSICS_MATERIALS, projectPath, scanned);
}

export function createPhysicsMaterialAsset(
  projectPath: string,
  name: string,
  material: PhysicsMaterialDef,
): Promise<string> {
  return createInLibrary(PHYSICS_MATERIALS, projectPath, name, material);
}

export function savePhysicsMaterialAsset(
  projectPath: string,
  assetPath: string,
  material: PhysicsMaterialDef,
): Promise<void> {
  return saveInLibrary(PHYSICS_MATERIALS, projectPath, assetPath, material);
}

/**
 * Overwrites a prefab asset in place, for "apply overrides".
 *
 * Deliberately separate from `createPrefabAsset`: creating picks a free file
 * name, and reusing that here would leave every instance pointing at the file
 * the edit did not go into.
 */
export async function savePrefabAsset(
  projectPath: string,
  assetPath: string,
  prefab: PrefabDoc,
): Promise<void> {
  const file = resolveInside(projectPath, assetPath);
  if (!file.endsWith(PREFAB_EXTENSION)) {
    throw new AssetError(`${assetPath} is not a prefab asset.`);
  }

  await writeFile(file, stableJson(prefab), 'utf8');

  // The hash names the content, so leaving it stale would make a later
  // duplicate check compare against a file that no longer exists.
  const meta = await readAssetMeta(file);
  if (meta) await writeAssetMeta(file, { ...meta, hash: await hashFile(file) });
}

/** Rejects the characters a folder name cannot carry across platforms. */
