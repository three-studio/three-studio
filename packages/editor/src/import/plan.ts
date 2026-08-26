import type { ImportPlanItem, StagedFile } from '@three-studio/core';
import type { SettingsDraft } from './settingsPane';

/** One line of the dialog: a staged file, and what the author has decided. */
export interface ImportRow {
  file: StagedFile;
  included: boolean;
  /** `null` when nothing imports the file, and there is nothing to decide. */
  settings: SettingsDraft | null;
}

/**
 * A file with no importer cannot be included, and one the project already has
 * byte for byte starts excluded — importing it again is allowed, but it should
 * be a decision rather than the default.
 */
export function createRows(files: readonly StagedFile[]): ImportRow[] {
  return files.map((file) => ({
    file,
    included: file.importerId !== null && file.conflict?.kind !== 'duplicate',
    settings: (file.settings as SettingsDraft | null) ?? null,
  }));
}

/**
 * What the commit is asked to do.
 *
 * Pure, and the only thing that crosses to the main process: everything the
 * dialog knows that is not in here — the previews, the probes, the rows that
 * were unticked — stops at the boundary.
 */
export function buildImportPlan(rows: readonly ImportRow[], folder: string): ImportPlanItem[] {
  return rows
    .filter((row) => row.included && row.settings !== null && row.file.importerId !== null)
    .map((row) => ({
      fileId: row.file.id,
      folder,
      fileName: row.file.fileName,
      settings: row.settings as ImportPlanItem['settings'],
    }));
}

/**
 * Copies one row's settings onto every row of the same format.
 *
 * "Apply to all" means all of a kind, not all of everything: forty textures
 * dropped together usually want one answer, and the FBX beside them does not
 * even have the same fields. Matching on the importer rather than on the asset
 * kind is what keeps an OBJ's settings off an FBX.
 */
export function applySettingsToKin(rows: readonly ImportRow[], sourceId: string): ImportRow[] {
  const source = rows.find((row) => row.file.id === sourceId);
  if (!source || source.settings === null) return [...rows];

  return rows.map((row) => {
    if (row.file.id === sourceId) return row;
    if (row.file.importerId !== source.file.importerId) return row;
    return {
      ...row,
      // Each keeps whatever only its own bytes could say. A texture's encoding
      // was sniffed per file, and copying one file's onto another would tell an
      // ordinary JPEG it is an Ultra HDR image.
      settings: { ...source.settings, ...perFile(row.settings) } as SettingsDraft,
    };
  });
}

/** The settings a file owns outright, which no "apply to all" may overwrite. */
function perFile(settings: SettingsDraft | null): Record<string, unknown> {
  if (settings?.kind === 'texture') return { encoding: settings.encoding };
  // A clip's length, channel count and rate are facts about *that* file, read
  // when the preview decoded it. Copying one clip's onto forty others would put
  // a confident, wrong duration on every one of them in the Project panel.
  if (settings?.kind === 'audio') {
    return {
      seconds: settings.seconds,
      channels: settings.channels,
      sampleRate: settings.sampleRate,
    };
  }
  return {};
}

/** Back to what the session staged, which is the only defaults that saw the file. */
export function resetRow(rows: readonly ImportRow[], id: string): ImportRow[] {
  return rows.map((row) =>
    row.file.id === id
      ? { ...row, settings: (row.file.settings as SettingsDraft | null) ?? null }
      : row,
  );
}

export function updateRowSettings(
  rows: readonly ImportRow[],
  id: string,
  settings: SettingsDraft,
): ImportRow[] {
  return rows.map((row) => (row.file.id === id ? { ...row, settings } : row));
}

export interface ImportSummary {
  included: number;
  importable: number;
  unsupported: number;
  duplicates: number;
}

export function summarise(rows: readonly ImportRow[]): ImportSummary {
  return {
    included: rows.filter((row) => row.included).length,
    importable: rows.filter((row) => row.file.importerId !== null).length,
    unsupported: rows.filter((row) => row.file.importerId === null).length,
    duplicates: rows.filter((row) => row.file.conflict?.kind === 'duplicate').length,
  };
}
