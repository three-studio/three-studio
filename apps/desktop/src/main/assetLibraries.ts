import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { posix } from 'node:path';
import {
  ASSETS_DIR,
  ASSET_KIND_INFO,
  ASSET_META_VERSION,
  MATERIAL_ASSET_VERSION,
  PREFAB_FORMAT_VERSION,
  createId,
  createMaterial,
  defaultSettings,
  safeFileName,
  stableJson,
  type AssetManifest,
  type AssetMeta,
  migratePrefab,
  type MaterialAssetFile,
  type MaterialDef,
  type PrefabDoc,
} from '@three-studio/core';
import { resolveInside } from './paths';
import { AssetError, hashFile, uniqueFileName } from './assetFiles';
import { readAssetMeta, scanAssets, writeAssetMeta } from './assetScan';

/*
 * The two asset kinds the editor writes as well as reads: materials and
 * prefabs.
 *
 * Both are JSON documents of ours rather than files someone imported, so both
 * have a format version, a migration on read, and a write that has to keep the
 * sidecar's hash in step with the bytes.
 */

const MATERIAL_EXTENSION = '.material.json';
const PREFAB_EXTENSION = '.prefab.json';

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
 * Every preset material in the project, keyed by asset id.
 *
 * Read in one pass because the binder builds meshes synchronously: a material
 * fetched per reference would leave the mesh untextured for a frame, and a
 * scene with a hundred of them would do a hundred round trips.
 */
/** @param scanned See `readPrefabAssets`. */
export async function readMaterialAssets(
  projectPath: string,
  scanned?: AssetManifest,
): Promise<Record<string, MaterialDef>> {
  const manifest = scanned ?? (await scanAssets(projectPath));
  const materials: Record<string, MaterialDef> = {};

  await Promise.all(
    manifest.assets
      .filter((asset) => asset.kind === 'material' && asset.path.endsWith(MATERIAL_EXTENSION))
      .map(async (asset) => {
        try {
          const raw = await readFile(resolveInside(projectPath, asset.path), 'utf8');
          const parsed = JSON.parse(raw) as MaterialAssetFile;
          // A material written by a newer build may use parameters this one
          // would silently drop, so it is left out rather than half-applied.
          if (parsed.version > MATERIAL_ASSET_VERSION) return;
          // Filled the same way scenes are: a material written before a
          // property existed would otherwise hand `undefined` to three and to
          // the inspector, and Tweakpane cannot build a control for that — it
          // throws and takes the whole panel with it.
          materials[asset.id] = { ...createMaterial(), ...parsed.material };
        } catch {
          // A corrupt material must not stop the others from loading; the mesh
          // that references it falls back to its embedded value.
        }
      }),
  );

  return materials;
}

/** Writes a new material asset and its sidecar; returns the new asset id. */
export async function createMaterialAsset(
  projectPath: string,
  name: string,
  material: MaterialDef,
): Promise<string> {
  const directory = posix.join(ASSETS_DIR, ASSET_KIND_INFO.material.directory);
  await mkdir(resolveInside(projectPath, directory), { recursive: true });

  const safe = safeFileName(name) || 'Material';
  const fileName = await uniqueFileName(
    projectPath,
    directory,
    `${safe}${MATERIAL_EXTENSION}`,
    MATERIAL_EXTENSION,
  );
  const file = resolveInside(projectPath, posix.join(directory, fileName));

  const contents: MaterialAssetFile = { version: MATERIAL_ASSET_VERSION, material };
  await writeFile(file, stableJson(contents), 'utf8');

  // The sidecar carries the id every scene will reference, so it is written
  // here rather than left to the next scan to invent.
  const meta: AssetMeta = {
    version: ASSET_META_VERSION,
    id: createId(),
    kind: 'material',
    importedAt: Date.now(),
    hash: await hashFile(file),
    settings: defaultSettings('material', fileName),
  };
  await writeAssetMeta(file, meta);
  return meta.id;
}

/** Overwrites an existing material asset in place, keeping its id. */
export async function saveMaterialAsset(
  projectPath: string,
  assetPath: string,
  material: MaterialDef,
): Promise<void> {
  const file = resolveInside(projectPath, assetPath);
  if (!file.endsWith(MATERIAL_EXTENSION)) {
    throw new AssetError(`${assetPath} is not a material asset.`);
  }

  const contents: MaterialAssetFile = { version: MATERIAL_ASSET_VERSION, material };
  await writeFile(file, stableJson(contents), 'utf8');

  // The hash names the content, so leaving it stale would make a later
  // duplicate check compare against a file that no longer exists.
  const meta = await readAssetMeta(file);
  if (meta) await writeAssetMeta(file, { ...meta, hash: await hashFile(file) });
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
