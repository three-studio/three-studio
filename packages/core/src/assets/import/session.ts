import type { AssetKind, AssetSettings } from '../schema';

/**
 * What is already in the project that this file would collide with.
 *
 * `duplicate` is the same bytes under some other name — re-importing them would
 * mint a second id for one asset and quietly double the project's size.
 * `name` is a different file that happens to be called the same thing.
 */
export type ImportConflict =
  | { kind: 'duplicate'; existingPath: string; existingId: string }
  | { kind: 'name'; existingPath: string };

/**
 * A file waiting to be imported.
 *
 * Nothing it describes is on disk yet: the session holds the source paths, the
 * settings the author is editing and the facts read to show them, and the
 * project is not touched until the import is confirmed. Abandoning the dialog —
 * or crashing with it open — therefore leaves nothing behind, in the project or
 * anywhere else.
 */
export interface StagedFile {
  /** Unique within the session. How the renderer names a file back. */
  id: string;
  /** Base name, as it will be written unless it is renamed. */
  fileName: string;
  /** Absolute source path. Shown to the author; never accepted back as a key. */
  sourcePath: string;
  sizeBytes: number;
  /** `null` when nothing in the registry claims the extension. */
  importerId: string | null;
  kind: AssetKind | null;
  /** The importer's name, for the format column. */
  formatLabel: string;
  /** `null` for a file with no importer; there is nothing to configure. */
  settings: AssetSettings | null;
  conflict: ImportConflict | null;
  /** Side files that will be copied along with it, relative to the source. */
  companions: readonly string[];
}

export interface ImportSessionState {
  sessionId: string;
  files: readonly StagedFile[];
  /** Where the dialog starts, taken from where the files were dropped. */
  folder: string;
}

/** What the author decided about one file. */
export interface ImportPlanItem {
  fileId: string;
  /** Folder relative to `assets/`; `''` is the top level. */
  folder: string;
  /** May differ from the staged name: renaming resolves a collision. */
  fileName: string;
  settings: AssetSettings;
}

/**
 * The URL a staged file is readable at, for previewing before it is imported.
 *
 * `studio-import://session/<session>/<file>/<name>`, and the last segment is
 * load bearing twice over: the loaders pick their parser from the extension,
 * and three's `extractUrlBase` resolves a `.mtl` or a `.bin` against it — so a
 * companion asks for `…/<file>/textures/bark.png` without anything having to
 * arrange it.
 *
 * Addressed by session and file id rather than by path, because the renderer
 * must not be able to name an arbitrary file on the machine. The main process
 * resolves the pair against a session it opened and serves only that file and
 * the companions it read out of it — nothing else in the folder, and nothing
 * outside it.
 *
 * Both ids sit in the **path**, under a constant host. An id is case-sensitive
 * and a host is not: every URL parser lowercases it, so a session called
 * `Xq4A` arrived as `xq4a`, matched nothing, and every preview 404'd. The asset
 * scheme has a constant host for its own reasons; this one has it for this.
 */
export const IMPORT_SCHEME = 'studio-import';

/** The only host accepted, so nothing case-sensitive is ever spelled there. */
export const IMPORT_HOST = 'session';

export function importPreviewUrl(sessionId: string, file: StagedFile): string {
  const name = file.fileName.split('/').map(encodeURIComponent).join('/');
  return `${IMPORT_SCHEME}://${IMPORT_HOST}/${encodeURIComponent(sessionId)}/${encodeURIComponent(file.id)}/${name}`;
}

export interface ImportPreviewRequest {
  sessionId: string;
  fileId: string;
  /** The file itself, or a companion path relative to it. */
  relativePath: string;
}

/**
 * Reads back what `importPreviewUrl` wrote. `null` for anything else.
 *
 * Here rather than in the protocol handler so it can be tested: the handler
 * needs Electron, and the part worth pinning is this — an id that survives the
 * round trip with its case intact.
 */
export function parseImportPreviewUrl(raw: string): ImportPreviewRequest | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== `${IMPORT_SCHEME}:` || url.host !== IMPORT_HOST) return null;

  const segments = url.pathname
    .replace(/^\/+/, '')
    .split('/')
    .map((segment) => decodeURIComponent(segment));
  const sessionId = segments.shift();
  const fileId = segments.shift();
  if (!sessionId || !fileId || segments.length === 0) return null;

  return { sessionId, fileId, relativePath: segments.join('/') };
}
