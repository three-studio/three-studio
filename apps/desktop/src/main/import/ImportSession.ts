import { stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import {
  createId,
  importerForFile,
  type AssetEntry,
  type AssetImportResult,
  type ImportConflict,
  type ImportPlanItem,
  type ImportSessionState,
  type StagedFile,
} from '@three-studio/core';
import { companionsOf, hashFile, scanAssets, settingsFor } from '../assets';
import { ImportPipeline } from './ImportPipeline';
import { expandSources } from './sources';

/** A staged file plus what only the main process needs to know about it. */
export interface StagedSource extends StagedFile {
  hash: string;
}

/**
 * Files waiting to be imported, and nothing else.
 *
 * The buffer the whole dialog is built around: the sources stay where the
 * author put them, the settings live here while they are being decided, and the
 * project is not touched until `commit`. Abandoning the dialog, or crashing
 * with it open, therefore leaves nothing behind — not in `assets/`, and not in
 * a temporary directory either, because there isn't one.
 *
 * It also decides what the renderer may read: a preview URL names a session and
 * a file, and only the files listed here, plus the companions read out of them,
 * ever resolve to bytes.
 */
export class ImportSession {
  readonly id = createId();
  private readonly sources = new Map<string, StagedSource>();

  private constructor(
    readonly projectPath: string,
    readonly folder: string,
  ) {}

  /**
   * Reads everything that was dropped, without writing anything.
   *
   * The hash is taken here rather than at commit because it is what answers
   * "you already have this", and that answer belongs in the list the author is
   * looking at, not in a message after the fact.
   */
  static async open(
    projectPath: string,
    paths: readonly string[],
    folder: string,
  ): Promise<ImportSession> {
    const session = new ImportSession(projectPath, folder);
    const { paths: expanded } = await expandSources(paths);

    const existing = await scanAssets(projectPath);
    const byHash = new Map(existing.assets.map((asset) => [asset.hash, asset]));
    const byName = new Map(existing.assets.map((asset) => [basename(asset.path), asset]));

    for (const sourcePath of expanded) {
      const staged = await stageOne(sourcePath, byHash, byName);
      session.sources.set(staged.id, staged);
    }
    return session;
  }

  state(): ImportSessionState {
    return {
      sessionId: this.id,
      folder: this.folder,
      // Without the hash: the renderer has no use for it, and it is the one
      // field here that costs something to produce.
      files: [...this.sources.values()].map(({ hash: _hash, ...file }) => file),
    };
  }

  /**
   * The file a preview URL names, and the paths it is allowed to reach.
   *
   * `null` for anything else, which is the point: the renderer addresses files
   * by session and id, so a compromised one cannot ask for `~/.ssh/id_rsa` by
   * spelling it out.
   */
  resolvePreview(fileId: string, relativePath: string): string | null {
    const source = this.sources.get(fileId);
    if (source === undefined) return null;
    if (relativePath === source.fileName) return source.sourcePath;
    // A loader that followed a reference out of the file itself — a `.gltf`'s
    // buffer, an `.obj`'s material library. Only the ones the importer actually
    // read out of it, never whatever the folder happens to contain.
    if (!source.companions.includes(relativePath)) return null;
    return join(dirname(source.sourcePath), relativePath);
  }

  /** Runs the import the author confirmed. The first thing to touch the disk. */
  async commit(plan: readonly ImportPlanItem[]): Promise<AssetImportResult> {
    const pipeline = new ImportPipeline(this.projectPath);
    const imported: AssetEntry[] = [];
    const unsupported: string[] = [];

    for (const item of plan) {
      const source = this.sources.get(item.fileId);
      // A plan naming a file this session never staged is not an error worth
      // failing the rest of the import over; it is a stale dialog.
      if (source === undefined || source.importerId === null) {
        if (source) unsupported.push(source.fileName);
        continue;
      }
      imported.push(await pipeline.run(source, item));
    }

    return { imported, duplicates: [], unsupported };
  }
}

async function stageOne(
  sourcePath: string,
  byHash: Map<string, AssetEntry>,
  byName: Map<string, AssetEntry>,
): Promise<StagedSource> {
  const fileName = basename(sourcePath);
  const importer = importerForFile(fileName);
  const info = await stat(sourcePath).catch(() => null);

  const base = {
    id: createId(),
    fileName,
    sourcePath,
    sizeBytes: info?.size ?? 0,
  };

  if (importer === undefined) {
    return {
      ...base,
      importerId: null,
      kind: null,
      formatLabel: '',
      settings: null,
      conflict: null,
      companions: [],
      hash: '',
    };
  }

  const hash = await hashFile(sourcePath).catch(() => '');
  return {
    ...base,
    importerId: importer.id,
    kind: importer.kind,
    formatLabel: importer.label,
    // Off the source rather than off the copy, which does not exist yet — the
    // two are byte-identical, and this is what puts an Ultra HDR sky's encoding
    // in front of the author before the import rather than after it.
    settings: await settingsFor(sourcePath, importer.kind),
    conflict: conflictFor(hash, fileName, byHash, byName),
    companions: [...(await companionsOf(sourcePath))],
    hash,
  };
}

function conflictFor(
  hash: string,
  fileName: string,
  byHash: Map<string, AssetEntry>,
  byName: Map<string, AssetEntry>,
): ImportConflict | null {
  const duplicate = hash === '' ? undefined : byHash.get(hash);
  if (duplicate) {
    // The same bytes under some other name. Importing anyway is allowed — it is
    // the author's project — but it mints a second id for one asset, and that
    // is worth being told before rather than after.
    return { kind: 'duplicate', existingPath: duplicate.path, existingId: duplicate.id };
  }
  const named = byName.get(fileName);
  return named ? { kind: 'name', existingPath: named.path } : null;
}

/**
 * Every open import session in this window.
 *
 * Sessions are in memory and nowhere else, so quitting is the only cleanup
 * there is to get wrong — and there is nothing on disk for it to leave behind.
 */
class ImportSessionStore {
  private readonly open = new Map<string, ImportSession>();

  async start(
    projectPath: string,
    paths: readonly string[],
    folder: string,
  ): Promise<ImportSessionState> {
    const session = await ImportSession.open(projectPath, paths, folder);
    this.open.set(session.id, session);
    return session.state();
  }

  get(sessionId: string): ImportSession | undefined {
    return this.open.get(sessionId);
  }

  /** Ends the session whether it was committed or abandoned. */
  close(sessionId: string): void {
    this.open.delete(sessionId);
  }

  /** Every session belonging to a project that is no longer open. */
  closeProject(projectPath: string): void {
    for (const [id, session] of this.open) {
      if (session.projectPath === projectPath) this.open.delete(id);
    }
  }
}

export const importSessions = new ImportSessionStore();
