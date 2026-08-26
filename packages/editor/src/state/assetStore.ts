import {
  emptyManifest,
  type AssetEntry,
  type AssetKind,
  type AssetManifest,
  type MaterialDef,
  type PrefabDoc,
} from '@three-studio/core';
import type { AssetResolver } from '@three-studio/runtime';
import { create } from 'zustand';
import { useDocumentStore } from './documentStore';

export type AssetSortKey = 'name' | 'importedAt' | 'sizeBytes' | 'kind';
export type AssetViewMode = 'grid' | 'list';

interface AssetState {
  manifest: AssetManifest;
  /**
   * Bumped whenever the manifest is replaced.
   *
   * The inspector computes a dropdown's options when it builds the pane, so
   * importing a texture while an object was selected left the slot listing the
   * assets that existed a moment earlier — the texture was on disk, in the
   * store and in the Project panel, and simply absent from the only control
   * that could apply it. Panels fold this into what they treat as their shape.
   */
  revision: number;
  /**
   * Contents of every preset material asset, by id.
   *
   * Held here rather than fetched on demand because the binder builds a mesh
   * synchronously; see `SceneBinder.setMaterialLibrary`.
   */
  materials: Record<string, MaterialDef>;
  /** Every prefab, by asset id. Pushed into the binder the same way. */
  prefabs: Record<string, PrefabDoc>;
  loading: boolean;
  error: string | null;

  // Browsing state, kept here so it survives the panel being re-docked.
  query: string;
  kindFilter: AssetKind | 'all';
  folder: string;
  sortKey: AssetSortKey;
  sortAscending: boolean;
  viewMode: AssetViewMode;
  tileSize: number;

  refresh: () => Promise<void>;
  /** Extracts an embedded material into a new asset; returns its id. */
  createMaterial: (name: string, material: MaterialDef) => Promise<string>;
  createPrefab: (name: string, prefab: PrefabDoc, assetId?: string) => Promise<string>;
  /** Writes back to a material asset, then re-reads so every user updates. */
  saveMaterial: (assetId: string, material: MaterialDef) => Promise<void>;
  savePrefab: (assetId: string, prefab: PrefabDoc) => Promise<void>;
  remove: (assetPath: string) => Promise<void>;
  move: (assetPath: string, targetFolder: string) => Promise<void>;
  /**
   * Creates a folder at a full path under `assets/`, returning the one it got.
   *
   * A full path rather than a name in the current folder: the import dialog
   * browses somewhere of its own, and it would otherwise create folders in
   * whatever the Project panel happened to be showing behind it.
   */
  createFolder: (path: string) => Promise<string | null>;
  /** Renames a folder and follows the current one through it. */
  renameFolder: (folder: string, name: string) => Promise<string | null>;
  /** Removes an empty folder; falls back to its parent if it was the one open. */
  removeFolder: (folder: string) => Promise<void>;
  clear: () => void;

  /** Brings an asset into view in the browser and flags it for a moment. */
  reveal: (assetId: string) => void;
  /** Set by `reveal`, cleared by the panel once it has drawn the highlight. */
  revealed: string | null;
  clearRevealed: () => void;

  setQuery: (query: string) => void;
  setKindFilter: (kind: AssetKind | 'all') => void;
  setFolder: (folder: string) => void;
  setSort: (key: AssetSortKey) => void;
  setViewMode: (mode: AssetViewMode) => void;
  setTileSize: (size: number) => void;

  byId: (assetId: string) => AssetEntry | undefined;
  byKind: (kind: AssetKind) => AssetEntry[];
}

/** `guard`, for an action whose result the caller needs. `null` means it failed. */
async function guardValue<T>(
  set: (partial: Partial<AssetState>) => void,
  action: () => Promise<T>,
): Promise<T | null> {
  set({ loading: true, error: null });
  try {
    return await action();
  } catch (cause) {
    set({ error: cause instanceof Error ? cause.message : String(cause) });
    return null;
  } finally {
    set({ loading: false });
  }
}

async function guard(
  set: (partial: Partial<AssetState>) => void,
  action: () => Promise<void>,
): Promise<void> {
  await guardValue(set, action);
}

export const useAssetStore = create<AssetState>()((set, get) => ({
  manifest: emptyManifest(),
  materials: {},
  prefabs: {},
  revision: 0,
  loading: false,
  error: null,

  query: '',
  revealed: null,
  kindFilter: 'all',
  folder: '',
  sortKey: 'name',
  sortAscending: true,
  viewMode: 'grid',
  tileSize: 88,

  refresh: () =>
    guard(set, async () => {
      const [manifest, materials, prefabs] = await Promise.all([
        window.studio.assets.list(),
        window.studio.assets.readMaterials(),
        window.studio.assets.readPrefabs(),
      ]);
      set({ manifest, materials, prefabs, revision: get().revision + 1 });
      useDocumentStore.getState().noteLibraryChange('materials');
      useDocumentStore.getState().noteLibraryChange('prefabs');
    }),

  createPrefab: async (name, prefab, assetId) => {
    const created = await window.studio.assets.createPrefab(name, prefab, assetId);
    await get().refresh();
    return created;
  },

  createMaterial: async (name, material) => {
    const assetId = await window.studio.assets.createMaterial(name, material);
    await get().refresh();
    return assetId;
  },

  saveMaterial: async (assetId, material) => {
    const entry = get().byId(assetId);
    if (!entry) return;
    await window.studio.assets.saveMaterial(entry.path, material);
    // Update in place as well as re-reading: the round trip is a few
    // milliseconds, and a slider that snaps back in between reads as a bug.
    const materials = { ...get().materials, [assetId]: material };
    set({ materials });
    useDocumentStore.getState().noteLibraryChange('materials');
  },

  savePrefab: async (assetId, prefab) => {
    const entry = get().byId(assetId);
    if (!entry) return;
    await window.studio.assets.savePrefab(entry.path, prefab);
    // Updated in place as well as written: every instance re-expands from this
    // table, and waiting for a re-read would show the old shape in between.
    const prefabs = { ...get().prefabs, [assetId]: prefab };
    set({ prefabs, revision: get().revision + 1 });
    useDocumentStore.getState().noteLibraryChange('prefabs');
  },

  remove: (assetPath) =>
    guard(set, async () => {
      await window.studio.assets.remove(assetPath);
      set({ manifest: await window.studio.assets.list(), revision: get().revision + 1 });
    }),

  move: (assetPath, targetFolder) =>
    guard(set, async () => {
      await window.studio.assets.move(assetPath, targetFolder);
      set({ manifest: await window.studio.assets.list(), revision: get().revision + 1 });
    }),

  createFolder: (path) =>
    guardValue(set, async () => {
      const created = await window.studio.assets.createFolder(path);
      set({ manifest: await window.studio.assets.list(), revision: get().revision + 1 });
      return created;
    }),

  renameFolder: (folder, name) =>
    guardValue(set, async () => {
      const renamed = await window.studio.assets.renameFolder(folder, name);
      set({
        manifest: await window.studio.assets.list(),
        revision: get().revision + 1,
        folder: remapFolder(get().folder, folder, renamed),
      });
      return renamed;
    }),

  removeFolder: (folder) =>
    guard(set, async () => {
      await window.studio.assets.removeFolder(folder);
      set({
        manifest: await window.studio.assets.list(),
        revision: get().revision + 1,
        folder: remapFolder(get().folder, folder, null),
      });
    }),

  clear: () =>
    set({
      manifest: emptyManifest(),
      materials: {},
      prefabs: {},
      revision: get().revision + 1,
      error: null,
          folder: '',
      query: '',
    }),

  reveal: (assetId) => {
    const entry = get().byId(assetId);
    if (!entry) return;
    // Folder and filters cleared, not just the folder: an asset hidden behind
    // a kind filter or a stale search would be "revealed" onto an empty grid.
    set({ folder: entry.folder, query: '', kindFilter: 'all', revealed: assetId });
  },
  clearRevealed: () => set({ revealed: null }),

  setQuery: (query) => set({ query }),
  setKindFilter: (kindFilter) => set({ kindFilter }),
  setFolder: (folder) => set({ folder }),
  setSort: (key) =>
    set((state) =>
      // Clicking the active column flips direction, like every file browser.
      state.sortKey === key
        ? { sortAscending: !state.sortAscending }
        : { sortKey: key, sortAscending: true },
    ),
  setViewMode: (viewMode) => set({ viewMode }),
  setTileSize: (tileSize) => set({ tileSize }),

  byId: (assetId) => get().manifest.assets.find((asset) => asset.id === assetId),
  byKind: (kind) => get().manifest.assets.filter((asset) => asset.kind === kind),
}));

/**
 * Unity's typed search: a bare word matches the name, `t:` narrows by type and
 * `f:` by folder, so a query like `t:texture rock` reads the way it does there.
 */
export function filterAndSortAssets(state: {
  manifest: AssetManifest;
  query: string;
  kindFilter: AssetKind | 'all';
  folder: string;
  sortKey: AssetSortKey;
  sortAscending: boolean;
}): AssetEntry[] {
  const terms = state.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const nameTerms: string[] = [];
  let typeTerm: string | null = null;
  let folderTerm: string | null = null;

  for (const term of terms) {
    if (term.startsWith('t:')) typeTerm = term.slice(2);
    else if (term.startsWith('f:')) folderTerm = term.slice(2);
    else nameTerms.push(term);
  }

  // A search looks across the whole project; without one, browsing is scoped
  // to the selected folder.
  const searching = terms.length > 0;

  const filtered = state.manifest.assets.filter((asset) => {
    if (state.kindFilter !== 'all' && asset.kind !== state.kindFilter) return false;
    if (typeTerm !== null && !asset.kind.startsWith(typeTerm)) return false;
    if (folderTerm !== null && !asset.folder.toLowerCase().includes(folderTerm)) return false;

    if (!searching && asset.folder !== state.folder) return false;

    const haystack = asset.name.toLowerCase();
    return nameTerms.every((term) => haystack.includes(term));
  });

  const direction = state.sortAscending ? 1 : -1;
  return filtered.sort((a, b) => {
    switch (state.sortKey) {
      case 'name':
        return a.name.localeCompare(b.name) * direction;
      case 'kind':
        return (a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)) * direction;
      case 'sizeBytes':
        return (a.sizeBytes - b.sizeBytes) * direction;
      case 'importedAt':
        return (a.importedAt - b.importedAt) * direction;
    }
  });
}

/**
 * Follows a folder through a rename or a removal of one of its ancestors.
 *
 * `to === null` means it was removed, and the answer is its parent. The prefix
 * test is on `${from}/` rather than `from` because a bare `startsWith` also
 * matches `models-old` when `models` is renamed, and quietly moves the browser
 * into a folder that was never touched.
 */
export function remapFolder(current: string, from: string, to: string | null): string {
  if (from === '') return current;
  if (current !== from && !current.startsWith(`${from}/`)) return current;
  if (to === null) return from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
  return `${to}${current.slice(from.length)}`;
}

/** Immediate child folders of `parent`, for the folder tree. */
export function childFolders(manifest: AssetManifest, parent: string): string[] {
  const prefix = parent === '' ? '' : `${parent}/`;
  const children = new Set<string>();

  for (const folder of manifest.folders) {
    if (!folder.startsWith(prefix) || folder === parent) continue;
    const rest = folder.slice(prefix.length);
    if (rest === '' || rest.includes('/')) continue;
    children.add(folder);
  }
  return [...children].sort();
}

/**
 * Maps asset ids onto the custom protocol the main process serves.
 *
 * This is the editor's half of the runtime's `AssetResolver`; an exported web
 * build supplies a different one that points at files inside the bundle, and
 * the runtime never has to know which it got.
 */
/*
 * The two module-level callback slots that used to live here are gone.
 *
 * One listener was possible at a time, and `dispose()` unsubscribed globally —
 * so a second viewport was impossible by construction, and a remounted panel
 * silently stopped receiving. Library changes now go through the document's
 * revision log like everything else, which every consumer reads at its own pace.
 */

export const editorAssetResolver: AssetResolver = {
  url: (assetId) => {
    const entry = useAssetStore.getState().byId(assetId);
    if (!entry) return null;
    const encoded = entry.path.split('/').map(encodeURIComponent).join('/');
    return `studio-asset://project/${encoded}`;
  },
  // Off the sidecar, where the import worked it out from the file's own bytes.
  // The manifest is a cache of those sidecars, so this costs a map lookup where
  // deriving it again would cost a read of every image in the project.
  encoding: (assetId) => {
    const settings = useAssetStore.getState().byId(assetId)?.settings;
    return settings?.kind === 'texture' ? settings.encoding : null;
  },
  // What the author chose in the import dialog, from the same cache. This is
  // what makes an Unreal FBX the size it was imported at rather than the size
  // it was exported at.
  settings: (assetId) => useAssetStore.getState().byId(assetId)?.settings ?? null,
};
