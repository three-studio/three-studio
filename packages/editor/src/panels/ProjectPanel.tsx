import {
  ArrowDownAZ,
  ArrowUpAZ,
  FilePlus2,
  FolderPlus,
  LayoutGrid,
  List,
  Plus,
  Search,
  Upload,
  Volume2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { childFolders, filterAndSortAssets, useAssetStore } from '../state/assetStore';
import { askForText } from '../state/dialogStore';
import { createFolder } from '../commands/assetCommands';
import { useScriptStore } from '../state/scriptStore';
import { audioPreview } from '../audio/preview';
import { PanelToolbar } from './PanelShell';
import { browseAndImport, openImportDialog } from '../import/importStore';
import { AssetList } from './project/AssetList';
import { Breadcrumbs } from './project/Breadcrumbs';
import { KIND_FILTERS, SORT_LABELS } from './project/kinds';
import { AssetTile, FolderTile } from './project/tiles';



/*
 * One selector per field, and it used to be `useAssetStore()` — the whole
 * store, the last such subscription in the repo. Every field woke this panel
 * and its grid: `revision`, `loading`, and the material and prefab tables,
 * none of which it draws. The two panels beside it carry comments about the
 * re-render storms they have already paid for; this one had not paid yet.
 *
 * Actions are selected rather than read through `getState()` where they are
 * used in the markup: zustand keeps their identity, so selecting one adds no
 * wake-up and reads as what it is.
 */
export function ProjectPanel() {
  const manifest = useAssetStore((s) => s.manifest);
  const query = useAssetStore((s) => s.query);
  const kindFilter = useAssetStore((s) => s.kindFilter);
  const folder = useAssetStore((s) => s.folder);
  const sortKey = useAssetStore((s) => s.sortKey);
  const sortAscending = useAssetStore((s) => s.sortAscending);
  const viewMode = useAssetStore((s) => s.viewMode);
  const tileSize = useAssetStore((s) => s.tileSize);
  const error = useAssetStore((s) => s.error);
  const revealed = useAssetStore((s) => s.revealed);
  const loading = useAssetStore((s) => s.loading);

  const setQuery = useAssetStore((s) => s.setQuery);
  const setKindFilter = useAssetStore((s) => s.setKindFilter);
  const setSort = useAssetStore((s) => s.setSort);
  const setViewMode = useAssetStore((s) => s.setViewMode);

  const [dropping, setDropping] = useState(false);
  // Seeded from the audition itself, which is the source of truth: the value
  // then survives this panel being closed and reopened without a store of its
  // own, and without inventing a project preference nobody asked for.
  const [previewVolume, setPreviewVolume] = useState(() => audioPreview.volume);

  useEffect(() => {
    void useAssetStore.getState().refresh();
  }, []);

  const assets = useMemo(
    () => filterAndSortAssets({ manifest, query, kindFilter, folder, sortKey, sortAscending }),
    [manifest, query, kindFilter, folder, sortKey, sortAscending],
  );

  const folders = useMemo(() => childFolders(manifest, folder), [manifest, folder]);
  const searching = query.trim() !== '';

  const onDropFiles = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    setDropping(false);

    // `File.path` no longer exists in Electron's renderer; the preload exposes
    // `webUtils.getPathForFile`, which is the supported replacement.
    const paths = [...event.dataTransfer.files].map((file) =>
      window.studio.assets.pathForFile(file),
    );
    if (paths.length > 0) void openImportDialog(paths);
  };

  return (
    <div
      className="flex h-full w-full flex-col bg-surface-1"
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={onDropFiles}
    >
      <PanelToolbar>
        <button
          type="button"
          disabled={loading}
          onClick={() => void browseAndImport()}
          className="flex h-5 shrink-0 items-center gap-1 rounded-sm bg-surface-3 px-1.5 text-2xs text-ink hover:bg-surface-4 disabled:opacity-50"
        >
          <Plus size={11} />
          Import
        </button>

        <button
          type="button"
          title="New folder"
          onClick={() => void createFolder(folder)}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-ink-muted hover:bg-surface-3 hover:text-ink"
        >
          <FolderPlus size={12} />
        </button>

        <button
          type="button"
          title="New script"
          onClick={() => {
            void askForText({
              title: 'New Script',
              label: 'Class name',
              defaultValue: 'NewScript',
              confirmLabel: 'Create',
              validate: (value) =>
                /^[A-Za-z_][A-Za-z0-9_]*$/.test(value.trim())
                  ? null
                  : 'A script name becomes a class name: letters, digits and underscores only.',
            }).then((name) => {
              if (!name) return;
              void window.studio.scripts
                .create(name)
                .then(() => useAssetStore.getState().refresh())
                .then(() => useScriptStore.getState().build())
                .catch((cause: unknown) => {
                  console.error('[scripts] could not create the script:', cause);
                });
            });
          }}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-ink-muted hover:bg-surface-3 hover:text-ink"
        >
          <FilePlus2 size={12} />
        </button>

        <div className="mx-1 flex min-w-24 flex-1 items-center gap-1 rounded-sm bg-surface-1 px-1.5">
          <Search size={11} className="shrink-0 text-ink-dim" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search   t:texture  f:props"
            className="min-w-0 flex-1 bg-transparent py-0.5 text-2xs text-ink outline-none placeholder:text-ink-dim"
          />
          {searching && (
            <button type="button" onClick={() => setQuery('')} className="text-ink-dim hover:text-ink">
              <X size={11} />
            </button>
          )}
        </div>

        <button
          type="button"
          title={`Sort by ${SORT_LABELS[sortKey]}`}
          onClick={() => setSort(sortKey)}
          className="flex h-5 shrink-0 items-center gap-1 rounded-sm px-1.5 text-2xs text-ink-muted hover:bg-surface-3 hover:text-ink"
        >
          {sortAscending ? <ArrowDownAZ size={12} /> : <ArrowUpAZ size={12} />}
          {SORT_LABELS[sortKey]}
        </button>

        {/*
          The editor's own audition level, not the project's (ADR-0012). It lives
          here because this is where auditioning is done, and one preview engine
          means it governs the Inspector's ▶ Play just as much as this panel's
          tiles.
        */}
        <div className="flex shrink-0 items-center gap-1" title="Audition volume">
          <Volume2 size={12} className="text-ink-muted" />
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={previewVolume}
            onChange={(event) => {
              audioPreview.volume = Number(event.target.value);
              // Read back rather than kept as typed: the audition clamps and
              // refuses what is not finite, and a slider that disagrees with the
              // thing it drives is worse than no slider.
              setPreviewVolume(audioPreview.volume);
            }}
            className="h-5 w-12 accent-accent"
          />
        </div>

        <div className="flex shrink-0 items-center">
          {(['grid', 'list'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              title={`${mode} view`}
              onClick={() => setViewMode(mode)}
              className={`flex h-5 w-5 items-center justify-center rounded-sm ${
                viewMode === mode ? 'bg-accent-dim text-ink' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {mode === 'grid' ? <LayoutGrid size={12} /> : <List size={12} />}
            </button>
          ))}
        </div>
      </PanelToolbar>

      <div className="flex items-center gap-1 border-b border-line bg-surface-2/60 px-2 py-1">
        {KIND_FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            onClick={() => setKindFilter(filter.value)}
            className={`rounded-sm px-1.5 py-0.5 text-2xs ${
              kindFilter === filter.value ? 'bg-accent-dim text-ink' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {filter.label}
          </button>
        ))}
        <div className="flex-1" />
        <span className="text-2xs text-ink-dim">
          {assets.length} {assets.length === 1 ? 'asset' : 'assets'}
        </span>
      </div>

      {error !== null && (
        <div className="flex items-start gap-2 bg-error/15 px-2 py-1 text-2xs text-error">
          <span className="flex-1" data-selectable>
            {error}
          </span>
        </div>
      )}

      <Breadcrumbs folder={folder} searching={searching} />

      <div className="relative min-h-0 flex-1 overflow-auto p-2">
        {folders.length === 0 && assets.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-ink-dim">
            <Upload size={24} strokeWidth={1.25} />
            <p className="text-2xs">
              {searching ? 'No match.' : 'Drop models, textures or shaders here, or use Import.'}
            </p>
          </div>
        ) : viewMode === 'grid' ? (
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(auto-fill,minmax(${tileSize}px,1fr))` }}
          >
            {!searching &&
              folders.map((path) => (
                <FolderTile key={path} path={path} />
              ))}
            {assets.map((asset) => (
              <AssetTile key={asset.id} asset={asset} revealed={asset.id === revealed} />
            ))}
          </div>
        ) : (
          <AssetList
            assets={assets}
            folders={searching ? [] : folders}
            sortKey={sortKey}
            revealed={revealed}
          />
        )}

        {dropping && (
          <div className="pointer-events-none absolute inset-1 rounded-sm border-2 border-dashed border-accent bg-accent/10" />
        )}
      </div>
    </div>
  );
}
