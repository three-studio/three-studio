import { createHash } from 'node:crypto';
import {
  link,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, extname, join, posix, relative, sep } from 'node:path';
import {
  ASSETS_DIR,
  ASSET_KIND_INFO,
  ASSET_META_SUFFIX,
  ASSET_META_VERSION,
  assetKindForFile,
  MATERIAL_ASSET_VERSION,
  PREFAB_FORMAT_VERSION,
  assetDisplayName,
  createId,
  createMaterial,
  defaultSettings,
  emptyManifest,
  importerForFile,
  type TextReader,
  type AssetManifest,
  type AssetMeta,
  type AssetSettings,
  type TextureEncoding,
  migratePrefab,
  type MaterialAssetFile,
  type MaterialDef,
  type PrefabDoc,
} from '@three-studio/core';
import { resolveInside } from './paths';

export class AssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssetError';
  }
}

/**
 * Rebuilds the asset list by walking `assets/` and reading each sidecar.
 *
 * Scanning rather than trusting a stored index is what makes the editor
 * tolerant of the file system: a model moved in Finder keeps its id, a file
 * copied in by hand is adopted, and a deleted file simply stops appearing.
 */
export async function scanAssets(projectPath: string): Promise<AssetManifest> {
  const assetsRoot = join(projectPath, ASSETS_DIR);
  const manifest = emptyManifest();

  const seenSidecars = new Set<string>();
  const sidecarsFound: string[] = [];

  const walk = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return; // The project may predate the assets tree.
    }

    for (const entry of entries) {
      const full = join(directory, entry.name);

      if (entry.isDirectory()) {
        manifest.folders.push(toPosix(relative(assetsRoot, full)));
        await walk(full);
        continue;
      }

      if (entry.name.endsWith(ASSET_META_SUFFIX)) {
        sidecarsFound.push(full);
        continue;
      }

      const kind = assetKindForFile(entry.name);
      if (kind === undefined) continue;

      const meta = await readOrCreateMeta(full, kind);
      seenSidecars.add(`${full}${ASSET_META_SUFFIX}`);

      const info = await stat(full);
      manifest.assets.push({
        id: meta.id,
        name: assetDisplayName(entry.name),
        kind: meta.kind,
        path: toPosix(relative(projectPath, full)),
        folder: toPosix(relative(assetsRoot, directory)),
        sizeBytes: info.size,
        modifiedAt: info.mtimeMs,
        importedAt: meta.importedAt,
        hash: meta.hash,
        settings: meta.settings,
      });
    }
  };

  await walk(assetsRoot);

  // A sidecar whose asset is gone is dead weight, and would resurrect a stale
  // id if a different file were later given the same name.
  for (const sidecar of sidecarsFound) {
    if (!seenSidecars.has(sidecar)) await rm(sidecar, { force: true });
  }

  manifest.folders.sort();
  return manifest;
}

export async function readAssetMeta(assetFile: string): Promise<AssetMeta | null> {
  try {
    const raw = await readFile(`${assetFile}${ASSET_META_SUFFIX}`, 'utf8');
    const parsed = JSON.parse(raw) as AssetMeta;
    if (typeof parsed.id !== 'string' || parsed.id === '') return null;
    if (parsed.version > ASSET_META_VERSION) return null;
    // Filled the same way scenes and materials are: a sidecar written before a
    // kind gained a setting would otherwise hand `undefined` to whatever reads
    // it. `basename` because `defaultSettings` distinguishes a TSL material
    // from a preset by its file name.
    return {
      ...parsed,
      settings: {
        ...defaultSettings(parsed.kind, basename(assetFile)),
        ...parsed.settings,
      } as AssetSettings,
    };
  } catch {
    return null;
  }
}

/**
 * Writes a sidecar so that no reader can ever see half of one.
 *
 * Through a temporary file and a rename, which is atomic: a reader gets the old
 * bytes or the new ones, never a truncated file. `writeFile` alone does not
 * give that, and the gap is reachable, because a scan writes sidecars as well
 * as reading them and more than one can be in flight — `exportBuild` ran three
 * at once until it was made to read the tree once, and the IPC handlers behind
 * the material and prefab libraries still scan independently.
 *
 * The failure was not a crash. A half-written sidecar fails to parse,
 * `readAssetMeta` answers `null`, and the asset is adopted **with a fresh id** —
 * so a scene that referenced it now references nothing, and an export ships a
 * level with a texture missing. It showed up first as a test that passed four
 * runs out of six.
 *
 * The temporary name carries an id of its own so that two writers racing on one
 * sidecar do not overwrite each other's half-written file.
 */
export async function writeAssetMeta(assetFile: string, meta: AssetMeta): Promise<void> {
  const target = `${assetFile}${ASSET_META_SUFFIX}`;
  const staging = `${target}.${createId()}.tmp`;
  try {
    await writeFile(staging, JSON.stringify(meta, null, 2), 'utf8');
    await rename(staging, target);
  } catch (cause) {
    await rm(staging, { force: true });
    throw cause;
  }
}

/** True for the "it was already there" failure, and only that one. */
function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'
  );
}

/**
 * Writes the first sidecar a file has ever had, and loses gracefully.
 *
 * `link` refuses rather than replaces, which is what makes this a claim instead
 * of a write: two scans running at once on a project of hand-dropped files each
 * mint an id, exactly one lands, and the loser adopts the winner's. Without
 * that they hand back different ids for the same file — and the id is what
 * every scene in the project references, so the two disagree about what the
 * project even contains.
 *
 * The content is complete before it is linked, so a third reader arriving
 * mid-write sees no file rather than half of one.
 *
 * @returns What is on disk afterwards, which may be someone else's.
 */
async function claimAssetMeta(assetFile: string, meta: AssetMeta): Promise<AssetMeta> {
  const target = `${assetFile}${ASSET_META_SUFFIX}`;
  const staging = `${target}.${createId()}.tmp`;
  try {
    await writeFile(staging, JSON.stringify(meta, null, 2), 'utf8');
    await link(staging, target);
    return meta;
  } catch (cause) {
    if (isAlreadyExists(cause)) return (await readAssetMeta(assetFile)) ?? meta;
    // Hard links are not available on every volume — exFAT and some network
    // mounts refuse them. Losing the race is far less likely than losing the
    // asset, so fall back to the plain write rather than leave the file with no
    // sidecar at all.
    await writeAssetMeta(assetFile, meta);
    return meta;
  } finally {
    await rm(staging, { force: true });
  }
}

/**
 * How many bytes of an image are read to identify it.
 *
 * JPEG puts its APP segments immediately after the start-of-image marker, so
 * everything looked for below is in the first few kilobytes of any file that
 * has it. A quarter of a megabyte is slack, not a budget.
 */
const SNIFF_BYTES = 256 * 1024;

/**
 * What says a JPEG is an Ultra HDR image and not a photograph.
 *
 * The current standard writes an ISO 21496-1 box in an APP2 segment; the format
 * as Android first shipped it writes an XMP block in APP1. `UltraHDRLoader`
 * requires one or the other and refuses the file without them, so these are
 * exactly the two questions worth asking.
 */
const ULTRAHDR_MARKERS = ['urn:iso:std:iso:ts:21496:-1', 'hdrgm:Version'];

/**
 * The encoding of an image, read from its bytes rather than from its name.
 *
 * Only JPEGs need this — every other format the editor accepts is named by its
 * extension, which `defaultSettings` already reads. Returns `null` for anything
 * it has no opinion on, so the caller keeps the guess it already had.
 *
 * Done where the sidecar is written and nowhere else. Doing it per scan would
 * be a quarter-megabyte read per image per refresh; doing it at load time would
 * be a second fetch of a file already being downloaded.
 */
async function sniffTextureEncoding(assetFile: string): Promise<TextureEncoding | null> {
  const lower = assetFile.toLowerCase();
  if (!lower.endsWith('.jpg') && !lower.endsWith('.jpeg')) return null;

  const head = Buffer.allocUnsafe(SNIFF_BYTES);
  let read = 0;
  let handle;
  try {
    handle = await open(assetFile, 'r');
    ({ bytesRead: read } = await handle.read(head, 0, SNIFF_BYTES, 0));
  } catch {
    return null;
  } finally {
    await handle?.close();
  }

  // `latin1` because these are byte strings inside a binary file, not text: it
  // maps every byte to one character, where `utf8` would fold invalid sequences
  // into replacement characters and could swallow a marker.
  const text = head.subarray(0, read).toString('latin1');
  return ULTRAHDR_MARKERS.some((marker) => text.includes(marker)) ? 'ultrahdr' : 'sdr';
}

/**
 * The settings for a file, with anything only its bytes can answer filled in.
 *
 * `defaultSettings` is synchronous and sees a name; this is the other half.
 */
export async function settingsFor(
  assetFile: string,
  kind: AssetMeta['kind'],
  stored?: AssetSettings,
): Promise<AssetSettings> {
  const settings = stored ?? defaultSettings(kind, basename(assetFile));
  if (settings.kind !== 'texture') return settings;

  const encoding = await sniffTextureEncoding(assetFile);
  // Overwritten rather than merged under: `encoding` did not exist before meta
  // format 2, so a stored one is either ours or absent — never the author's.
  return encoding === null ? settings : { ...settings, encoding };
}

/**
 * Adopts a file that has no sidecar yet — the "dropped in by hand" case — and
 * upgrades one an older build wrote.
 *
 * The upgrade is written back rather than filled in memory, which is where this
 * differs from the scene migration. A scene is read once and saved by the
 * author; a sidecar is read on every scan, and the field format 2 added costs a
 * file read to work out. Paying that once per file is the point of the bump.
 */
async function readOrCreateMeta(assetFile: string, kind: AssetMeta['kind']): Promise<AssetMeta> {
  const existing = await readAssetMeta(assetFile);
  if (existing && existing.version === ASSET_META_VERSION) return existing;

  const meta: AssetMeta = {
    version: ASSET_META_VERSION,
    id: existing?.id ?? createId(),
    kind,
    importedAt: existing?.importedAt ?? Date.now(),
    hash: existing?.hash ?? (await hashFile(assetFile)),
    settings: await settingsFor(assetFile, kind, existing?.settings),
  };

  // Claimed when the file has never had a sidecar, because then the id is newly
  // minted and two scans would mint two. Plainly written when one exists: the
  // id is read back off it, so every writer produces the same bytes and the
  // last one through is as correct as the first.
  if (existing) {
    await writeAssetMeta(assetFile, meta);
    return meta;
  }
  return claimAssetMeta(assetFile, meta);
}

export async function updateAssetSettings(
  projectPath: string,
  assetPath: string,
  settings: AssetSettings,
): Promise<void> {
  const assetFile = resolveInside(projectPath, assetPath);
  const meta = await readAssetMeta(assetFile);
  if (!meta) throw new AssetError(`No metadata for ${assetPath}.`);
  await writeAssetMeta(assetFile, { ...meta, settings });
}

/**
 * Reads a file relative to the one being imported.
 *
 * The `fs` half of `TextReader`, which is what lets an importer in `core` — a
 * package that must not know `node` exists — follow a `.gltf` into its buffers
 * or an `.obj` into its material library. Refuses to climb out of the source's
 * own folder, since a reference is data and this reads whatever it says.
 */
function readerBeside(source: string): TextReader {
  const root = dirname(source);
  return async (relativePath) => {
    try {
      const target = resolveInside(root, toPosix(relativePath));
      return await readFile(target, 'utf8');
    } catch {
      // Absent, unreadable, or pointing outside: not an error. A model naming a
      // texture that was never shipped still imports, and the loader is what
      // produces the message the author can act on.
      return null;
    }
  };
}

/**
 * The files a model needs beside it.
 *
 * `.glb` and `.fbx` carry everything inside them; `.gltf` and `.obj` do not,
 * and importing one on its own copies a file that then cannot find its own
 * geometry. Which references exist and how to read them belongs to the format,
 * so the answer comes from its importer; this only supplies the filesystem.
 *
 * Paths come back relative to the model, so a `textures/wood.png` reference
 * lands in a `textures/` folder next to it and resolves exactly as it did.
 */
export async function companionsOf(source: string): Promise<string[]> {
  const fileName = basename(source);
  const importer = importerForFile(fileName);
  if (importer === undefined) return [];
  return [...(await importer.companions(fileName, readerBeside(source)))];
}

export async function removeAsset(projectPath: string, assetPath: string): Promise<void> {
  const target = resolveInside(projectPath, assetPath);

  // Read before deleting: the companions are named inside the file, so once it
  // is gone there is nothing left to ask. Otherwise a deleted model leaves its
  // buffer and its textures behind, and the next scan adopts the textures as
  // assets of their own.
  const companions = await companionsOf(target);

  await rm(target, { force: true });
  await rm(`${target}${ASSET_META_SUFFIX}`, { force: true });

  for (const companion of companions) {
    const file = resolveInside(projectPath, posix.join(posix.dirname(assetPath), companion));
    await rm(file, { force: true });
    await rm(`${file}${ASSET_META_SUFFIX}`, { force: true });
  }

  await pruneEmptyFolders(projectPath, dirname(target));
}

/**
 * Removes directories a delete or a move emptied, up to `assets/` itself.
 *
 * A multi-file model owns its folder, so taking the model out leaves the folder
 * behind — and an empty folder in the browser reads as a place something used
 * to be, which is exactly the confusion to avoid.
 */
async function pruneEmptyFolders(projectPath: string, from: string): Promise<void> {
  const root = join(projectPath, ASSETS_DIR);
  let directory = from;

  while (directory.startsWith(root) && directory !== root) {
    try {
      if ((await readdir(directory)).length > 0) return;
      // `rmdir`, not `rm`: `rm` refuses a directory unless it is told to
      // recurse, and this threw `EISDIR` straight into the catch below on every
      // call — so nothing was ever pruned, and the empty folders this exists to
      // clear away stayed in the browser looking like places something was.
      await rmdir(directory);
    } catch {
      return;
    }
    directory = dirname(directory);
  }
}

/** Moves an asset (and its sidecar) into another folder under `assets/`. */
export async function moveAsset(
  projectPath: string,
  assetPath: string,
  targetFolder: string,
): Promise<string> {
  const source = resolveInside(projectPath, assetPath);
  const fileName = basename(assetPath);

  // A model whose companions are named from inside it cannot be separated from
  // them, and they cannot be renamed. It keeps a folder of its own wherever it
  // goes — the same rule the import follows, so the layout stays predictable.
  const companions = await companionsOf(source);
  const base = posix.join(ASSETS_DIR, targetFolder);
  let directory = base;

  if (companions.length > 0) {
    const wanted = posix.join(base, assetDisplayName(fileName));
    directory =
      resolveInside(projectPath, wanted) === dirname(source)
        ? wanted
        : posix.join(
            base,
            await uniqueFolderName(projectPath, base, assetDisplayName(fileName)),
          );
  }

  const destinationDir = resolveInside(projectPath, directory);
  await mkdir(destinationDir, { recursive: true });

  const destination = join(destinationDir, fileName);
  if (destination === source) return assetPath;

  await rename(source, destination);
  // The sidecar carries the id, so it has to travel with the file or the asset
  // would be adopted again under a new id and every reference would break.
  await rename(`${source}${ASSET_META_SUFFIX}`, `${destination}${ASSET_META_SUFFIX}`).catch(
    () => undefined,
  );

  for (const companion of companions) {
    const from = join(dirname(source), ...companion.split('/'));
    const to = join(destinationDir, ...companion.split('/'));
    try {
      await mkdir(dirname(to), { recursive: true });
      await rename(from, to);
      await rename(`${from}${ASSET_META_SUFFIX}`, `${to}${ASSET_META_SUFFIX}`).catch(
        () => undefined,
      );
    } catch {
      // Already missing. The model is the thing being moved; a companion that
      // was not there before is not this operation's to report.
    }
  }

  await pruneEmptyFolders(projectPath, dirname(source));

  return toPosix(relative(projectPath, destination));
}

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

  const safe = name.trim().replace(/[/\\:*?"<>|]/g, '-') || 'Prefab';
  const fileName = await uniqueFileName(
    projectPath,
    directory,
    `${safe}${PREFAB_EXTENSION}`,
    PREFAB_EXTENSION,
  );
  const file = resolveInside(projectPath, posix.join(directory, fileName));
  await writeFile(file, JSON.stringify(prefab, null, 2), 'utf8');

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

  const safe = name.trim().replace(/[/\\:*?"<>|]/g, '-') || 'Material';
  const fileName = await uniqueFileName(
    projectPath,
    directory,
    `${safe}${MATERIAL_EXTENSION}`,
    MATERIAL_EXTENSION,
  );
  const file = resolveInside(projectPath, posix.join(directory, fileName));

  const contents: MaterialAssetFile = { version: MATERIAL_ASSET_VERSION, material };
  await writeFile(file, JSON.stringify(contents, null, 2), 'utf8');

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
  await writeFile(file, JSON.stringify(contents, null, 2), 'utf8');

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

  await writeFile(file, JSON.stringify(prefab, null, 2), 'utf8');

  // The hash names the content, so leaving it stale would make a later
  // duplicate check compare against a file that no longer exists.
  const meta = await readAssetMeta(file);
  if (meta) await writeAssetMeta(file, { ...meta, hash: await hashFile(file) });
}

/** Rejects the characters a folder name cannot carry across platforms. */
const ILLEGAL_IN_NAME = /[/\\:*?"<>|]/g;

/**
 * Creates a folder under `assets/`, returning the path it actually got.
 *
 * The leaf goes through `uniqueFolderName`, so asking twice for `New Folder`
 * gives a second folder rather than silently doing nothing — and the caller can
 * navigate into whatever was created rather than into what it asked for.
 */
export async function createAssetFolder(projectPath: string, folder: string): Promise<string> {
  const parent = posix.dirname(folder);
  const base = parent === '.' ? '' : parent;
  const leaf = posix.basename(folder).trim().replace(ILLEGAL_IN_NAME, '-');
  if (leaf === '') throw new AssetError('A folder needs a name.');

  const directory = posix.join(ASSETS_DIR, base);
  await mkdir(join(projectPath, directory), { recursive: true });

  const name = await uniqueFolderName(projectPath, directory, leaf);
  const created = posix.join(base, name);
  await mkdir(resolveInside(projectPath, posix.join(ASSETS_DIR, created)));
  return created;
}

/**
 * Renames a folder under `assets/`, returning its new path.
 *
 * Nothing else has to be rewritten. An asset's id lives in the `.meta.json`
 * beside it and scenes only ever reference ids, so renaming the directory
 * carries every identity with it — see the note on `AssetMeta`. What does go
 * stale is the manifest, which the caller re-reads.
 */
export async function renameAssetFolder(
  projectPath: string,
  folder: string,
  name: string,
): Promise<string> {
  if (folder === '') throw new AssetError('The assets folder itself cannot be renamed.');

  const safe = name.trim().replace(ILLEGAL_IN_NAME, '-');
  if (safe === '') throw new AssetError('A folder needs a name.');

  const parent = posix.dirname(folder);
  const target = parent === '.' ? safe : posix.join(parent, safe);
  if (target === folder) return folder;

  const source = resolveInside(projectPath, posix.join(ASSETS_DIR, folder));
  const destination = resolveInside(projectPath, posix.join(ASSETS_DIR, target));

  // A rename that only changes case is the same directory on a case-insensitive
  // volume, so the collision check would refuse `props` -> `Props` on the very
  // machine most of this is developed on.
  if (target.toLowerCase() !== folder.toLowerCase()) {
    try {
      await stat(destination);
      throw new AssetError(`A folder named ${safe} is already there.`);
    } catch (cause) {
      if (cause instanceof AssetError) throw cause;
    }
  }

  await rename(source, destination);
  return target;
}

/**
 * Removes a folder under `assets/`. Refuses anything that is not empty.
 *
 * Deleting assets destroys their ids, and an id is what every scene reference
 * is — so emptying a folder is a separate, deliberate act, taken one asset at a
 * time where the usage of each is reported.
 */
export async function removeAssetFolder(projectPath: string, folder: string): Promise<void> {
  if (folder === '') throw new AssetError('The assets folder itself cannot be removed.');

  const directory = resolveInside(projectPath, posix.join(ASSETS_DIR, folder));
  const entries = await readdir(directory);
  if (entries.length > 0) {
    throw new AssetError(`${folder} is not empty.`);
  }

  // `rmdir` rather than `rm`: it refuses a directory with anything in it, so
  // the check above is backed by the syscall rather than trusted on its own.
  //
  // Deliberately not `pruneEmptyFolders` afterwards: that exists so a move does
  // not leave a hole behind. Here the author named one folder, and watching its
  // parent vanish along with it is not what they asked for.
  await rmdir(directory);
}

export async function hashFile(path: string): Promise<string> {
  const bytes = await readFile(path);
  return createHash('sha256').update(bytes).digest('hex');
}

/** `tree.glb`, then `tree-1.glb`, so an import never silently overwrites. */
/**
 * @param extension Overrides the extension used to build the suffixed variant.
 *   Needed for compound extensions: without it `Brick.material.json` collides
 *   into `Brick.material-1.json`, which no longer reads as a material.
 */
/** `Tree`, then `Tree-1`, so a second import never lands in the first's folder. */
export async function uniqueFolderName(
  projectPath: string,
  directory: string,
  name: string,
): Promise<string> {
  const safe = name.trim().replace(/[/\\:*?"<>|]/g, '-') || 'Model';

  for (let index = 0; index < 1000; index++) {
    const candidate = index === 0 ? safe : `${safe}-${index}`;
    try {
      await stat(join(projectPath, directory, candidate));
    } catch {
      return candidate;
    }
  }
  return `${safe}-${Date.now()}`;
}

export async function uniqueFileName(
  projectPath: string,
  directory: string,
  fileName: string,
  extension = extname(fileName),
): Promise<string> {
  const base = fileName.slice(0, fileName.length - extension.length);

  for (let index = 0; index < 1000; index++) {
    const candidate = index === 0 ? fileName : `${base}-${index}${extension}`;
    try {
      await stat(join(projectPath, directory, candidate));
    } catch {
      return candidate;
    }
  }
  return `${base}-${Date.now()}${extension}`;
}

/** Manifest paths are always posix so they read the same on every platform. */
export function toPosix(path: string): string {
  return path.split(sep).join(posix.sep);
}
