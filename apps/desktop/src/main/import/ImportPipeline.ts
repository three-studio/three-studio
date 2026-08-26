import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, join, posix, relative, sep } from 'node:path';
import {
  ASSETS_DIR,
  ASSET_META_SUFFIX,
  ASSET_META_VERSION,
  assetDisplayName,
  createId,
  importerForFile,
  type AssetEntry,
  type AssetMeta,
  type ImportPlanItem,
} from '@three-studio/core';
import {
  AssetError,
  toPosix,
  uniqueFileName,
  uniqueFolderName,
  writeAssetMeta,
} from '../assets';
import { resolveInside } from '../paths';
import type { StagedSource } from './ImportSession';

/**
 * The suffix a file wears while it is being copied in.
 *
 * No importer claims `.importing`, so a scan walks straight past one: a copy
 * interrupted half way is never adopted as an asset, which is the failure worth
 * designing against. A truncated model with a sidecar of its own looks exactly
 * like a real asset, and the only symptom is a mesh that will not load.
 */
const STAGING_SUFFIX = '.importing';

/**
 * Copies one staged file into the project and writes its sidecar.
 *
 * The steps are the same for every format — where it lands, what it is called
 * when something is already called that, which side files come with it, what
 * goes in the sidecar — so they are written once here, and the parts that do
 * differ are asked of the file's importer.
 *
 * Nothing here runs until the author has confirmed the import. Up to that
 * point the session holds paths and settings and the project is untouched.
 */
export class ImportPipeline {
  constructor(private readonly projectPath: string) {}

  async run(source: StagedSource, item: ImportPlanItem): Promise<AssetEntry> {
    const importer = importerForFile(source.fileName);
    if (importer === undefined) {
      throw new AssetError(`Nothing imports ${source.fileName}.`);
    }

    const base = posix.join(ASSETS_DIR, item.folder || importer.directory);

    // A model that brings files with it gets a folder of its own. They are
    // named from inside the model — `scene.bin`, `material.mtl` — so two
    // imports dropped side by side would overwrite each other's, and renaming
    // them is not an option: the reference is in the file.
    const companions = source.companions;
    const directory =
      companions.length === 0
        ? base
        : posix.join(
            base,
            await uniqueFolderName(this.projectPath, base, assetDisplayName(item.fileName)),
          );
    await mkdir(resolveInside(this.projectPath, directory), { recursive: true });

    const unique =
      companions.length === 0
        ? await uniqueFileName(this.projectPath, directory, item.fileName)
        : item.fileName;
    const relativePath = posix.join(directory, unique);
    // The destination name comes from a file the author chose, so it goes
    // through the same guard as everything else.
    const destination = resolveInside(this.projectPath, relativePath);
    const staging = join(
      dirname(destination),
      `.${basename(destination)}.${createId()}${STAGING_SUFFIX}`,
    );

    const meta: AssetMeta = {
      version: ASSET_META_VERSION,
      id: createId(),
      kind: importer.kind,
      importedAt: Date.now(),
      hash: source.hash,
      settings: item.settings,
    };

    try {
      await copyFile(source.sourcePath, staging);
      // The sidecar before the asset, deliberately. Interrupted between the
      // two, this leaves a sidecar with no asset — which the next scan deletes
      // — rather than an asset with no sidecar, which the next scan would adopt
      // under a *new* id. The second is worse: the file is half a model, and it
      // now looks like a first-class one.
      await writeAssetMeta(destination, meta);
      await rename(staging, destination);
    } catch (cause) {
      await rm(staging, { force: true });
      await rm(`${destination}${ASSET_META_SUFFIX}`, { force: true });
      throw cause;
    }

    await this.copyCompanions(source, directory, companions);

    const info = await stat(destination);
    return {
      id: meta.id,
      name: assetDisplayName(unique),
      kind: importer.kind,
      path: relativePath,
      folder: toPosix(
        relative(join(this.projectPath, ASSETS_DIR), destination).split(sep).slice(0, -1).join(sep),
      ),
      sizeBytes: info.size,
      modifiedAt: info.mtimeMs,
      importedAt: meta.importedAt,
      hash: meta.hash,
      settings: meta.settings,
    };
  }

  private async copyCompanions(
    source: StagedSource,
    directory: string,
    companions: readonly string[],
  ): Promise<void> {
    for (const companion of companions) {
      // Each one keeps the sub-path the model refers to it by, and still has to
      // prove it stayed inside the project.
      const target = resolveInside(this.projectPath, posix.join(directory, toPosix(companion)));
      try {
        await mkdir(dirname(target), { recursive: true });
        await copyFile(join(dirname(source.sourcePath), companion), target);
      } catch {
        // Named but missing beside the source. The loader reports it, in terms
        // the author can act on.
      }
    }
  }
}
