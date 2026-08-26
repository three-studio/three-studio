import {
  FIT_TO_METRE,
  importerForFile,
  type AssetImportResult,
  type ImportSessionState,
} from '@three-studio/core';
import { create } from 'zustand';
import { remapFolder, useAssetStore } from '../state/assetStore';
import { notify } from '../state/toastStore';
import {
  applySettingsToKin,
  buildImportPlan,
  createRows,
  resetRow,
  updateRowSettings,
  type ImportRow,
} from './plan';
import type { AssetFacts } from './preview/facts';
import type { SettingsDraft } from './settingsPane';

interface PendingImport {
  resolve: (result: AssetImportResult | null) => void;
}

interface ImportState {
  sessionId: string | null;
  rows: ImportRow[];
  selectedId: string | null;
  /**
   * Where the batch lands. `''` keeps its old meaning — each format under the
   * directory its importer names — which is what the browser calls Automatic.
   */
  folder: string;
  /**
   * Which folder the destination browser is showing.
   *
   * Separate from `folder` only so that the root can be browsed while
   * Automatic is the choice; navigating into a folder sets both.
   */
  browsePath: string;
  /** What the preview read about the selected file; cleared when it changes. */
  facts: AssetFacts | null;
  /** True while the session is opening or the import is running. */
  busy: boolean;
  error: string | null;
  pending: PendingImport | null;

  select: (id: string) => void;
  setFacts: (facts: AssetFacts | null) => void;
  /** Picks a destination. `''` is Automatic. */
  setFolder: (folder: string) => void;
  /** Moves the browser without changing the destination. */
  browse: (path: string) => void;
  /** Opens a folder: it becomes both what is shown and where the batch lands. */
  enterFolder: (path: string) => void;
  /** Follows both paths through a rename (`to`) or a removal (`null`). */
  followFolder: (from: string, to: string | null) => void;
  toggle: (id: string) => void;
  toggleAll: (included: boolean) => void;
  editSettings: (id: string, settings: SettingsDraft) => void;
  applyToAll: (id: string) => void;
  reset: (id: string) => void;
  runAction: (id: string, key: string) => void;
  confirm: () => Promise<void>;
  cancel: () => void;
}

/**
 * The import dialog's state, and the only thing that opens it.
 *
 * Modelled on `askForText`: one call from anywhere, a promise back. Which is
 * what lets the three ways of importing — the drop on the project panel, the
 * toolbar button, the inspector's empty asset slot — be one flow. The slot in
 * particular needs the id of what was imported, and gets it from the promise.
 */
export const useImportStore = create<ImportState>()((set, get) => ({
  sessionId: null,
  rows: [],
  selectedId: null,
  folder: '',
  browsePath: '',
  facts: null,
  busy: false,
  error: null,
  pending: null,

  select: (id) => set({ selectedId: id, facts: null }),
  /**
   * Records what the preview found, and — for a clip — writes it into the
   * settings that will become the sidecar.
   *
   * This is the whole of ADR-6 in six lines. The renderer is the only thing in
   * the app that can read a sound's length: there is no `decodeAudioData` under
   * Node, so the main process cannot sniff it the way it sniffs an Ultra HDR
   * marker. The preview has already decoded the file to draw its waveform, and
   * throwing the answer away meant the Project panel could never show a
   * duration.
   */
  setFacts: (facts) =>
    set((state) => {
      const id = state.selectedId;
      if (facts?.kind !== 'audio' || id === null) return { facts };
      const row = state.rows.find((candidate) => candidate.file.id === id);
      if (!row || row.settings?.kind !== 'audio') return { facts };
      return {
        facts,
        rows: updateRowSettings(state.rows, id, {
          ...row.settings,
          seconds: facts.seconds,
          channels: facts.channels,
          sampleRate: facts.sampleRate,
        }),
      };
    }),
  setFolder: (folder) => set({ folder }),
  browse: (path) => set({ browsePath: path }),
  enterFolder: (path) => set({ browsePath: path, folder: path }),

  // Both, and by the same rule: a destination that survived a rename while the
  // browser did not would import into a folder nothing on screen names.
  followFolder: (from, to) =>
    set((state) => ({
      folder: remapFolder(state.folder, from, to),
      browsePath: remapFolder(state.browsePath, from, to),
    })),

  toggle: (id) =>
    set((state) => ({
      rows: state.rows.map((row) =>
        // A file nothing imports cannot be ticked into existence.
        row.file.id === id && row.file.importerId !== null
          ? { ...row, included: !row.included }
          : row,
      ),
    })),

  toggleAll: (included) =>
    set((state) => ({
      rows: state.rows.map((row) => ({
        ...row,
        included: included && row.file.importerId !== null,
      })),
    })),

  editSettings: (id, settings) => set((state) => ({ rows: updateRowSettings(state.rows, id, settings) })),
  applyToAll: (id) => set((state) => ({ rows: applySettingsToKin(state.rows, id) })),
  reset: (id) => set((state) => ({ rows: resetRow(state.rows, id) })),

  /**
   * Runs a button an importer declared.
   *
   * The importer cannot answer these itself — "fit to 1 m" needs the bounding
   * box, which only exists once the file has been opened, and opening files is
   * the preview's job. So the declaration lives with the format and the answer
   * lives here, where both the facts and the settings are in reach.
   */
  runAction: (id, key) => {
    const state = get();
    const row = state.rows.find((candidate) => candidate.file.id === id);
    if (!row || row.settings === null) return;

    if (key === FIT_TO_METRE) {
      const facts = state.facts;
      if (facts?.kind !== 'model') return;
      const extent = Math.max(...facts.size);
      if (!Number.isFinite(extent) || extent <= 0) return;
      // The tallest dimension becomes one unit. Not a guess at the true size —
      // a starting point that puts an Unreal export in the same world as the
      // grid, from which a real number is a nudge away rather than a rebuild.
      set({ rows: updateRowSettings(state.rows, id, { ...row.settings, scale: 1 / extent }) });
    }
  },

  confirm: async () => {
    const { sessionId, rows, folder, pending } = get();
    if (sessionId === null) return;

    set({ busy: true, error: null });
    try {
      const result = await window.studio.assets.commitImport(
        sessionId,
        buildImportPlan(rows, folder),
      );
      // The manifest is a cache of what is on disk, and what is on disk just
      // changed. Refreshed before the promise resolves, so a caller reading the
      // new asset back finds it in the store.
      await useAssetStore.getState().refresh();
      close(set);
      pending?.resolve(result);
      if (result.imported.length > 0) {
        notify({
          kind: 'success',
          title: `Imported ${result.imported.length} asset${result.imported.length === 1 ? '' : 's'}`,
        });
      }
    } catch (cause) {
      set({ busy: false, error: cause instanceof Error ? cause.message : String(cause) });
    }
  },

  cancel: () => {
    const { sessionId, pending } = get();
    // Nothing was written, so this is a forget rather than an undo.
    if (sessionId !== null) void window.studio.assets.cancelImport(sessionId);
    close(set);
    pending?.resolve(null);
  },
}));

type SetState = (partial: Partial<ImportState>) => void;

function close(set: SetState): void {
  set({
    sessionId: null,
    rows: [],
    selectedId: null,
    facts: null,
    busy: false,
    error: null,
    pending: null,
  });
}

/**
 * Stages files and opens the dialog. Resolves with what was imported, or `null`
 * if the author cancelled.
 *
 * Nothing reaches the project between this call and the author confirming.
 */
export function openImportDialog(sourcePaths: readonly string[]): Promise<AssetImportResult | null> {
  return start(() =>
    window.studio.assets.openImport(sourcePaths, useAssetStore.getState().folder),
  );
}

/** The native picker, then the same dialog. */
export function browseAndImport(): Promise<AssetImportResult | null> {
  return start(() =>
    window.studio.assets.browseAndOpenImport(useAssetStore.getState().folder),
  );
}

async function start(
  open: () => Promise<ImportSessionState>,
): Promise<AssetImportResult | null> {
  // A second request replaces the first rather than stacking dialogs, the same
  // rule the prompt and confirm dialogs follow.
  useImportStore.getState().cancel();
  useImportStore.setState({ busy: true, error: null });

  let session: ImportSessionState;
  try {
    session = await open();
  } catch (cause) {
    useImportStore.setState({ busy: false });
    notify({
      kind: 'error',
      title: 'Could not read those files',
      description: cause instanceof Error ? cause.message : String(cause),
    });
    return null;
  }

  // The picker was dismissed, or there was nothing importable in what was
  // dropped. Neither deserves an empty dialog.
  if (session.sessionId === '' || session.files.length === 0) {
    useImportStore.setState({ busy: false });
    if (session.sessionId !== '') void window.studio.assets.cancelImport(session.sessionId);
    return null;
  }

  const rows = createRows(session.files);
  return new Promise((resolve) => {
    useImportStore.setState({
      sessionId: session.sessionId,
      rows,
      folder: session.folder,
      browsePath: session.folder,
      selectedId: firstConfigurable(rows) ?? rows[0]?.file.id ?? null,
      facts: null,
      busy: false,
      error: null,
      pending: { resolve },
    });
  });
}

/** Opens on something worth looking at rather than on an unsupported file. */
function firstConfigurable(rows: readonly ImportRow[]): string | undefined {
  return rows.find((row) => row.file.importerId !== null)?.file.id;
}

/** The declared fields for a row, or `[]` when nothing imports it. */
export function fieldsFor(row: ImportRow) {
  const importer = importerForFile(row.file.fileName);
  if (importer === undefined || row.settings === null) return [];
  return importer.fields(row.settings);
}
