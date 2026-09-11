import { link, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import {
  ASSETS_DIR,
  ASSET_META_SUFFIX,
  ASSET_META_VERSION,
  ENGINE_VERSION,
  assetKindForFile,
  assetDisplayName,
  conformAssetSettings,
  createId,
  defaultSettings,
  emptyManifest,
  importerForFile,
  type TextReader,
  type AssetManifest,
  type AssetMeta,
  type AssetSettings,
  type TextureEncoding,
} from '@three-studio/core';
import { atomicWrite } from './atomicWrite';
import { resolveInside } from './paths';
import { FileIndex, stampOf } from './projectIndex';
import { AssetError, hashFile, toPosix } from './assetFiles';
import { ensureImported } from './importedAssets';

/*
 * What is in `assets/`, and what each file says about itself.
 *
 * The walk, the sidecars it reads and repairs, the content sniffing that
 * answers what a name cannot, and the reader that lets `core`'s importers
 * follow a `.gltf` into its buffers without knowing Node exists.
 */

/**
 * Rebuilds the asset list by walking `assets/`, reading the sidecars that have
 * moved since the last walk.
 *
 * Walking rather than trusting a stored list is what makes the editor tolerant
 * of the file system: a model moved in Finder keeps its id, a file copied in by
 * hand is adopted, and a deleted file simply stops appearing. The index below
 * does not weaken that — it is keyed on each sidecar's own mtime and size, so
 * it can only ever answer for a file that is still byte for byte the one it
 * read. What it saves is the open and the parse, which is nearly all of the
 * cost: 3000 assets took 284 ms before it and a small fraction of that after.
 *
 * It saves no *repair*. `readOrCreateMeta` writes back a sidecar that is
 * missing or out of date, and only a sidecar that was found current is ever
 * cached — so a file needing work goes down the same path it always did, and
 * `ASSET_META_VERSION` is named in the index's `builtBy` so that a bump throws
 * every cached value away rather than hiding the upgrade it demands.
 */
export async function scanAssets(projectPath: string): Promise<AssetManifest> {
  const assetsRoot = join(projectPath, ASSETS_DIR);
  const manifest = emptyManifest();
  const index = await FileIndex.open<AssetMeta>(
    projectPath,
    'assets.index.json',
    `${ENGINE_VERSION}:meta${ASSET_META_VERSION}`,
  );

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

      const metaFile = `${full}${ASSET_META_SUFFIX}`;
      seenSidecars.add(metaFile);
      const key = toPosix(relative(projectPath, full));

      // Two stats where there used to be a stat and a read: the asset's, whose
      // size and time the manifest carries anyway, and the sidecar's, which is
      // what says whether what was read last time still stands.
      const [info, stamp] = await Promise.all([stat(full), stampOf(metaFile)]);

      let meta = stamp === null ? undefined : index.reuse(key, stamp);
      if (!meta) {
        meta = await readOrCreateMeta(full, kind);
        // Stamped after the fact rather than before: `readOrCreateMeta` may
        // have just written this file, and on a first scan of hand-dropped
        // files it may have adopted a sidecar another scan won the race to
        // create. Either way what is on disk now is what to remember.
        const written = await stampOf(metaFile);
        if (written) index.put(key, written, meta);
      }

      const relativePath = toPosix(relative(projectPath, full));
      manifest.assets.push({
        id: meta.id,
        name: assetDisplayName(entry.name),
        kind: meta.kind,
        path: relativePath,
        folder: toPosix(relative(assetsRoot, directory)),
        sizeBytes: info.size,
        modifiedAt: info.mtimeMs,
        importedAt: meta.importedAt,
        hash: meta.hash,
        settings: meta.settings,
        // Built here, once, and a `stat` on every scan after that. The scan is
        // the only walk that already holds an asset's id, its hash and its
        // settings together, so doing it anywhere else would mean reading the
        // sidecars a second time.
        importedPath: await ensureImported(projectPath, meta, relativePath, info.size),
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
  await index.save();
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
 * This is the write `atomicWrite` was written for, and the argument for it is
 * there: a half-written sidecar is not a crash, it is an asset re-adopted under
 * a new id and a scene that now references nothing.
 */
export async function writeAssetMeta(assetFile: string, meta: AssetMeta): Promise<void> {
  await atomicWrite(`${assetFile}${ASSET_META_SUFFIX}`, JSON.stringify(meta, null, 2));
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
 * Not `atomicWrite`, and it cannot be: that ends in a `rename`, which replaces
 * whatever is there. Replacing is the one thing this must not do.
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
  // Conformed here rather than at the IPC handler, because this is where the
  // kind is known: the **sidecar's**, never the payload's. A renderer that
  // could choose the kind could have a `.png`'s settings filled from the model
  // importer's defaults, and the next load would build a mesh out of an image.
  const kept = conformAssetSettings(settings, meta.kind, basename(assetFile));
  await writeAssetMeta(assetFile, { ...meta, settings: kept });
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
