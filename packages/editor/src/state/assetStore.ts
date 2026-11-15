import {
  applyAssetChange,
  assetUrl,
  decodePrefab,
  emptyManifest,
  idMapOf,
  isAssetId,
  jsonOf,
  prefabJsonOf,
  unwrap,
  type AssetChange,
  type AssetEntry,
  type AssetId,
  type AssetKind,
  type AssetManifest,
  type CoreRegistries,
  type MaterialDef,
  type PhysicsMaterialDef,
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
  materials: ReadonlyMap<AssetId, MaterialDef>;
  /**
   * Every physics material, by asset id. Nothing in the edit view reads one:
   * Play, a launch and the Inspector read the table itself.
   */
  physicsMaterials: ReadonlyMap<AssetId, PhysicsMaterialDef>;
  /** Every prefab, by asset id. Pushed into the binder the same way. */
  prefabs: ReadonlyMap<AssetId, PrefabDoc>;
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

  /**
   * Reads the manifest and the libraries again. Given the window's registries,
   * which every prefab's components are decoded through — and so is every action
   * below that ends in it.
   */
  refresh: (registries: CoreRegistries) => Promise<void>;
  /** Extracts an embedded material into a new asset; returns its id. */
  createMaterial: (registries: CoreRegistries, name: string, material: MaterialDef) => Promise<AssetId>;
  createPrefab: (
    registries: CoreRegistries,
    name: string,
    prefab: PrefabDoc,
    assetId?: AssetId,
  ) => Promise<AssetId>;
  /** Writes back to a material asset, then re-reads so every user updates. */
  saveMaterial: (assetId: AssetId, material: MaterialDef) => Promise<void>;
  /** Writes a new physics material asset; returns its id. */
  createPhysicsMaterial: (
    registries: CoreRegistries,
    name: string,
    material: PhysicsMaterialDef,
  ) => Promise<AssetId>;
  /** Writes back to a physics material asset, every collider linking it following. */
  savePhysicsMaterial: (assetId: AssetId, material: PhysicsMaterialDef) => Promise<void>;
  /** Writes a prefab back, its file recording the versions of the types the window's registries define. */
  savePrefab: (registries: CoreRegistries, assetId: AssetId, prefab: PrefabDoc) => Promise<void>;
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
  reveal: (assetId: AssetId) => void;
  /** Set by `reveal`, cleared by the panel once it has drawn the highlight. */
  revealed: AssetId | null;
  clearRevealed: () => void;

  setQuery: (query: string) => void;
  setKindFilter: (kind: AssetKind | 'all') => void;
  setFolder: (folder: string) => void;
  setSort: (key: AssetSortKey) => void;
  setViewMode: (mode: AssetViewMode) => void;
  setTileSize: (size: number) => void;

  /** The entry an id names. */
  byId: (assetId: AssetId) => AssetEntry | undefined;
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

/**
 * Moves the manifest on by one mutation, instead of asking for a new one.
 *
 * Every mutation used to be followed by `assets.list()`, which is a full walk of
 * `assets/` in the main process and a manifest of every asset in the project
 * coming back across the bridge. Measured on three thousand assets: **196 ms**,
 * for a rename that touched one file. A change is a handful of paths, and
 * applying it is a substitution.
 *
 * Nothing here decides what happened — the main process says so, because it is
 * the only side that can. See `AssetChange`.
 *
 * The change is handed back so a caller can read the path an operation settled
 * on out of the same value the manifest was updated from, rather than out of a
 * second return that could disagree with it.
 */
function adopt(change: AssetChange): AssetChange {
  const { manifest, revision } = useAssetStore.getState();
  useAssetStore.setState({ manifest: applyAssetChange(manifest, change), revision: revision + 1 });
  return change;
}

export const useAssetStore = create<AssetState>()((set, get) => ({
  manifest: emptyManifest(),
  materials: new Map(),
  physicsMaterials: new Map(),
  prefabs: new Map(),
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

  refresh: (registries) =>
    guard(set, async () => {
      const [manifest, materialRecord, physicsMaterialRecord, prefabTexts] = await Promise.all([
        window.studio.assets.list(),
        window.studio.assets.readMaterials(),
        window.studio.assets.readPhysicsMaterials(),
        window.studio.assets.readPrefabs(),
      ]);
      // Records over the bridge, Maps here: a key read back as an id is checked
      // as one, and the prefab is read under it, as the main wrote it.
      const prefabs = new Map<AssetId, PrefabDoc>();
      for (const [id, text] of idMapOf(prefabTexts, isAssetId)) {
        prefabs.set(id, unwrap(decodePrefab(registries, text, id), `Prefab ${id}`));
      }
      set({
        manifest,
        materials: idMapOf(materialRecord, isAssetId),
        physicsMaterials: idMapOf(physicsMaterialRecord, isAssetId),
        prefabs,
        revision: get().revision + 1,
      });
      useDocumentStore.getState().noteLibraryChange('materials');
      useDocumentStore.getState().noteLibraryChange('prefabs');
    }),

  createPrefab: async (registries, name, prefab, assetId) => {
    const created = await window.studio.assets.createPrefab(name, jsonOf(prefabJsonOf(registries, prefab)), assetId ?? prefab.id);
    await get().refresh(registries);
    return created;
  },

  createMaterial: async (registries, name, material) => {
    const assetId = await window.studio.assets.createMaterial(name, material);
    await get().refresh(registries);
    return assetId;
  },

  saveMaterial: async (assetId, material) => {
    const entry = get().byId(assetId);
    if (!entry) return;
    await window.studio.assets.saveMaterial(entry.path, material);
    // Update in place as well as re-reading: the round trip is a few
    // milliseconds, and a slider that snaps back in between reads as a bug.
    const materials = new Map(get().materials).set(assetId, material);
    set({ materials });
    useDocumentStore.getState().noteLibraryChange('materials');
  },

  createPhysicsMaterial: async (registries, name, material) => {
    const assetId = await window.studio.assets.createPhysicsMaterial(name, material);
    await get().refresh(registries);
    return assetId;
  },

  savePhysicsMaterial: async (assetId, material) => {
    const entry = get().byId(assetId);
    if (!entry) return;
    await window.studio.assets.savePhysicsMaterial(entry.path, material);
    // In place as well, as `saveMaterial` does, so a slider does not snap back.
    set({ physicsMaterials: new Map(get().physicsMaterials).set(assetId, material) });
  },

  savePrefab: async (registries, assetId, prefab) => {
    const entry = get().byId(assetId);
    if (!entry) return;
    await window.studio.assets.savePrefab(entry.path, jsonOf(prefabJsonOf(registries, prefab)), assetId);
    // Updated in place as well as written: every instance re-expands from this
    // table, and waiting for a re-read would show the old shape in between.
    const prefabs = new Map(get().prefabs).set(assetId, prefab);
    set({ prefabs, revision: get().revision + 1 });
    useDocumentStore.getState().noteLibraryChange('prefabs');
  },

  remove: (assetPath) =>
    guard(set, async () => {
      const change = await window.studio.assets.remove(assetPath);
      const removed = new Set(change.removed);
      const gone = new Set(get().manifest.assets.filter((a) => removed.has(a.path)).map((a) => a.id));
      adopt(change);
      if (gone.size === 0) return;
      // Out of the tables too, which nothing reads again until a refresh: Play
      // went on bouncing a ball by a physics material the hierarchy called gone,
      // and a deleted material or prefab went on being drawn, where the delete
      // dialog says what linked it shows nothing.
      const kept = <T,>(table: ReadonlyMap<AssetId, T>) =>
        new Map([...table].filter(([id]) => !gone.has(id)));
      const { materials, physicsMaterials, prefabs } = get();
      set({ materials: kept(materials), physicsMaterials: kept(physicsMaterials), prefabs: kept(prefabs) });
      useDocumentStore.getState().noteLibraryChange('materials');
      useDocumentStore.getState().noteLibraryChange('prefabs');
    }),

  move: (assetPath, targetFolder) =>
    guard(set, async () => {
      adopt(await window.studio.assets.move(assetPath, targetFolder));
    }),

  createFolder: (path) =>
    guardValue(set, async () => {
      const change = adopt(await window.studio.assets.createFolder(path));
      // The path it settled on, which is not always the one asked for: the leaf
      // is suffixed on collision, and navigating into what was requested would
      // land nowhere. The deepest added folder is the one that was created.
      return change.addedFolders.at(-1) ?? null;
    }),

  renameFolder: (folder, name) =>
    guardValue(set, async () => {
      const change = adopt(await window.studio.assets.renameFolder(folder, name));
      const renamed = change.addedFolders[0] ?? null;
      if (renamed !== null) set({ folder: remapFolder(get().folder, folder, renamed) });
      return renamed;
    }),

  removeFolder: (folder) =>
    guard(set, async () => {
      const change = adopt(await window.studio.assets.removeFolder(folder));
      if (change.removedFolders.length > 0) {
        set({ folder: remapFolder(get().folder, folder, null) });
      }
    }),

  clear: () =>
    set({
      manifest: emptyManifest(),
      materials: new Map(),
      physicsMaterials: new Map(),
      prefabs: new Map(),
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
    // The kind lowered as the query is: `t:physicsmaterial` is how it is typed.
    if (typeTerm !== null && !asset.kind.toLowerCase().startsWith(typeTerm)) return false;
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
    // The scaled copy when the import made one. This is the single place the
    // editor decides that, which is what the resolver interface is for: nothing
    // downstream — not the cache, not a system, not a material slot — learns
    // that a source file and the file being loaded are ever different.
    return entry ? assetUrl(entry.importedPath ?? entry.path) : null;
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
