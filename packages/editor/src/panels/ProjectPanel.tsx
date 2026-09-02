import { hasImagePreview, type AssetEntry, type AssetKind } from '@three-studio/core';
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Box,
  Boxes,
  ChevronRight,
  FileCode,
  FilePlus2,
  FolderOpen,
  FolderPlus,
  Folder,
  Image,
  LayoutGrid,
  List,
  Palette,
  Pencil,
  Play,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  childFolders,
  filterAndSortAssets,
  useAssetStore,
  type AssetSortKey,
} from '../state/assetStore';
import { askForText } from '../state/dialogStore';
import { createFolder, deleteAsset, deleteFolder, renameFolder } from '../commands/assetCommands';
import { usePrefabModeStore } from '../state/prefabModeStore';
import { useScriptStore } from '../state/scriptStore';
import { ASSET_PATH_MIME, setAssetDragPayload } from '../assets/assetDrag';
import { clipPeaks } from '../audio/peaks';
import { audioPreview } from '../audio/preview';
import { drawPeaks } from '../audio/waveform';
import { PanelToolbar } from './PanelShell';
import { browseAndImport, openImportDialog } from '../import/importStore';



const KIND_ICON: Record<AssetKind, LucideIcon> = {
  model: Box,
  texture: Image,
  material: Palette,
  prefab: Boxes,
  shader: Sparkles,
  audio: Volume2,
  script: FileCode,
};

/** Explicit labels: naive pluralisation gives "Audios". */
const KIND_FILTERS: readonly { value: AssetKind | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'model', label: 'Models' },
  { value: 'texture', label: 'Textures' },
  { value: 'material', label: 'Materials' },
  { value: 'shader', label: 'Shaders' },
  { value: 'audio', label: 'Audio' },
  { value: 'script', label: 'Scripts' },
];

const SORT_LABELS: Record<AssetSortKey, string> = {
  name: 'Name',
  importedAt: 'Date',
  sizeBytes: 'Size',
  kind: 'Type',
};

export function ProjectPanel() {
  const store = useAssetStore();
  const {
    manifest,
    query,
    kindFilter,
    folder,
    sortKey,
    sortAscending,
    viewMode,
    tileSize,
    error,
    revealed,
    loading,
  } = store;

  const [dropping, setDropping] = useState(false);
  // Seeded from the audition itself, which is the source of truth: the value
  // then survives this panel being closed and reopened without a store of its
  // own, and without inventing a project preference nobody asked for.
  const [previewVolume, setPreviewVolume] = useState(() => audioPreview.volume);

  useEffect(() => {
    void store.refresh();
    // Refresh is stable; re-running on every store change would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
                .then(() => store.refresh())
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
            onChange={(event) => store.setQuery(event.target.value)}
            placeholder="Search   t:texture  f:props"
            className="min-w-0 flex-1 bg-transparent py-0.5 text-2xs text-ink outline-none placeholder:text-ink-dim"
          />
          {searching && (
            <button type="button" onClick={() => store.setQuery('')} className="text-ink-dim hover:text-ink">
              <X size={11} />
            </button>
          )}
        </div>

        <button
          type="button"
          title={`Sort by ${SORT_LABELS[sortKey]}`}
          onClick={() => store.setSort(sortKey)}
          className="flex h-5 shrink-0 items-center gap-1 rounded-sm px-1.5 text-2xs text-ink-muted hover:bg-surface-3 hover:text-ink"
        >
          {sortAscending ? <ArrowDownAZ size={12} /> : <ArrowUpAZ size={12} />}
          {SORT_LABELS[sortKey]}
        </button>

        {/*
          The editor's own audition level, not the project's (ADR-4). It lives
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
              onClick={() => store.setViewMode(mode)}
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
            onClick={() => store.setKindFilter(filter.value)}
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

      <Breadcrumbs folder={folder} searching={searching} onNavigate={store.setFolder} />

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
                <FolderTile
                  key={path}
                  path={path}
                  onOpen={() => store.setFolder(path)}
                  onDropAsset={(assetPath) => void store.move(assetPath, path)}
                />
              ))}
            {assets.map((asset) => (
              <AssetTile
                key={asset.id}
                asset={asset}
                revealed={asset.id === revealed}
                onRemove={() => void deleteAsset(asset)}
              />
            ))}
          </div>
        ) : (
          <AssetList
            assets={assets}
            folders={searching ? [] : folders}
            sortKey={sortKey}
            onSort={store.setSort}
            onOpenFolder={store.setFolder}
            revealed={revealed}
            onRemove={(path) => {
              const asset = assets.find((candidate) => candidate.path === path);
              if (asset) void deleteAsset(asset);
            }}
          />
        )}

        {dropping && (
          <div className="pointer-events-none absolute inset-1 rounded-sm border-2 border-dashed border-accent bg-accent/10" />
        )}
      </div>
    </div>
  );
}

function Breadcrumbs({
  folder,
  searching,
  onNavigate,
}: {
  folder: string;
  searching: boolean;
  onNavigate: (folder: string) => void;
}) {
  const segments = folder === '' ? [] : folder.split('/');

  return (
    <div className="flex items-center gap-0.5 border-b border-line px-2 py-1 text-2xs text-ink-muted">
      <button type="button" onClick={() => onNavigate('')} className="hover:text-ink">
        Assets
      </button>
      {segments.map((segment, index) => (
        <span key={segment} className="flex items-center gap-0.5">
          <ChevronRight size={10} className="text-ink-dim" />
          <button
            type="button"
            onClick={() => onNavigate(segments.slice(0, index + 1).join('/'))}
            className={index === segments.length - 1 ? 'text-ink' : 'hover:text-ink'}
          >
            {segment}
          </button>
        </span>
      ))}
      {searching && <span className="ml-2 text-ink-dim">— searching the whole project</span>}
    </div>
  );
}

function FolderTile({
  path,
  onOpen,
  onDropAsset,
}: {
  path: string;
  onOpen: () => void;
  onDropAsset: (assetPath: string) => void;
}) {
  const [over, setOver] = useState(false);
  const name = path.split('/').pop() ?? path;

  // A `div` with a `button` inside rather than one big button: the rename and
  // delete actions are buttons too, and a button inside a button is not markup
  // a browser agrees to lay out.
  return (
    <div
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(ASSET_PATH_MIME)) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const assetPath = event.dataTransfer.getData(ASSET_PATH_MIME);
        if (assetPath) onDropAsset(assetPath);
      }}
      className={`group relative aspect-square rounded-sm border bg-surface-2 ${
        over ? 'border-accent bg-accent/10' : 'border-line-soft/60 hover:border-accent/60'
      }`}
    >
      <button
        type="button"
        onDoubleClick={onOpen}
        onClick={onOpen}
        className="flex h-full w-full flex-col items-center justify-center gap-1.5 p-1"
      >
        <Folder size={22} strokeWidth={1.25} className="text-warn" />
        <span className="w-full truncate px-1 text-center text-2xs text-ink">{name}</span>
      </button>

      <button
        type="button"
        title="Delete folder"
        onClick={() => void deleteFolder(path)}
        className="absolute right-0.5 top-0.5 rounded-sm bg-surface-2/80 p-1 text-ink-dim opacity-0 hover:text-error group-hover:opacity-100"
      >
        <Trash2 size={11} />
      </button>
      <button
        type="button"
        title="Rename folder"
        onClick={() => void renameFolder(path)}
        className="absolute left-0.5 top-0.5 rounded-sm bg-surface-2/80 p-1 text-ink-dim opacity-0 hover:text-ink group-hover:opacity-100"
      >
        <Pencil size={11} />
      </button>
    </div>
  );
}

/**
 * A clip's shape on its tile, measured only once the tile is actually on screen.
 *
 * On screen, and not merely mounted: the grid is not virtualised, so opening a
 * folder of two hundred sounds mounts two hundred tiles in one go, and decoding
 * is the expensive half of this — the very cost `AudioClipCache` keeps a byte
 * budget for. An `IntersectionObserver` reduces that to the handful somebody is
 * looking at, and `ClipPeaks` keeps the answer so scrolling back is free.
 *
 * The canvas is laid out from the start even while blank, because an element
 * with no box never intersects anything and would wait for a decode that its own
 * hiding had prevented. The icon sits over it until there are peaks, and stays
 * for good when there are none: a file this browser cannot decode is not a
 * broken tile.
 */
function ClipWaveform({ assetId, Icon }: { assetId: string; Icon: LucideIcon }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const peaks = useRef<Float32Array | null>(null);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const element = canvas.current;
    if (element === null) return;

    const paint = () => {
      if (peaks.current === null) return;
      // Height from the box rather than the attribute: the bitmap then matches
      // the CSS size exactly, instead of being scaled into it.
      drawPeaks(element, peaks.current, { height: Math.max(1, element.clientHeight) });
    };

    let cancelled = false;
    const onScreen = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      onScreen.disconnect();
      void clipPeaks.peaks(assetId).then((measured) => {
        if (cancelled || measured === null) return;
        peaks.current = measured;
        setDrawn(true);
        paint();
      });
    });
    onScreen.observe(element);

    // A canvas is sized in CSS over a pixel buffer, so a grid that reflows leaves
    // the waveform drawn at the old width — stretched or cut. The import dialog
    // watches its panel for the same reason.
    const resized = new ResizeObserver(paint);
    resized.observe(element);

    return () => {
      cancelled = true;
      onScreen.disconnect();
      resized.disconnect();
    };
  }, [assetId]);

  return (
    <div className="relative flex min-h-0 w-full flex-1 items-center justify-center">
      <canvas ref={canvas} className="h-full w-full" />
      {!drawn && <Icon size={22} strokeWidth={1.25} className="absolute text-ink-muted" />}
    </div>
  );
}

function AssetTile({
  asset,
  revealed,
  onRemove,
}: {
  asset: AssetEntry;
  revealed: boolean;
  onRemove: () => void;
}) {
  const clearRevealed = useAssetStore((s) => s.clearRevealed);
  // Scrolled to and flashed, then forgotten: a highlight that stayed would
  // still be there next time the panel opened, meaning nothing.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!revealed) return;
    ref.current?.scrollIntoView({ block: 'nearest' });
    const timer = setTimeout(clearRevealed, 1600);
    return () => clearTimeout(timer);
  }, [revealed, clearRevealed]);

  const Icon = KIND_ICON[asset.kind];
  // Textures the browser can decode preview themselves through the asset
  // protocol; other kinds need a rendered thumbnail, which is a later
  // milestone. `hasImagePreview` rather than `kind === 'texture'` because an
  // `.hdr` is a texture an `<img>` cannot open, and it drew a broken tile.
  const previewUrl = hasImagePreview(asset)
    ? `studio-asset://project/${asset.path.split('/').map(encodeURIComponent).join('/')}`
    : null;

  return (
    <div
      ref={ref}
      draggable
      onDragStart={(event) => setAssetDragPayload(event.dataTransfer, asset)}
      onDoubleClick={() => {
        // Unity opens a prefab on double-click; anything else has no second
        // action worth guessing at.
        if (asset.kind === 'prefab') void usePrefabModeStore.getState().open(asset.id);
      }}
      title={`${asset.path}\n${formatBytes(asset.sizeBytes)} · imported ${new Date(asset.importedAt).toLocaleDateString()}`}
      className={`group relative flex aspect-square flex-col items-center justify-center gap-1.5 overflow-hidden rounded-sm border bg-surface-2 p-1 hover:border-accent/60 ${
        revealed ? 'border-accent ring-1 ring-accent' : 'border-line-soft/60'
      }`}
    >
      {previewUrl ? (
        <img
          src={previewUrl}
          alt=""
          className="min-h-0 flex-1 object-contain"
          style={{ imageRendering: 'auto' }}
        />
      ) : asset.kind === 'audio' ? (
        <ClipWaveform assetId={asset.id} Icon={Icon} />
      ) : (
        <Icon size={22} strokeWidth={1.25} className="text-ink-muted" />
      )}
      <span className="w-full truncate px-1 text-center text-2xs text-ink">{asset.name}</span>
      {/*
        What the file turned out to be, read when the import dialog decoded it.
        Absent for a clip dropped into `assets/` from outside the editor, and
        then the line is simply not drawn — better than a confident guess.
      */}
      {audioLine(asset) !== null && (
        <span className="w-full truncate px-1 text-center text-2xs text-ink-dim">
          {audioLine(asset)}
        </span>
      )}

      {asset.kind === 'audio' && (
        <button
          type="button"
          title="Audition this clip"
          // On a button and not on the tile itself: a panel that plays whatever
          // the pointer passes over is unbearable within three minutes, and a
          // panel that plays on selection makes arrow-key browsing a cacophony.
          onClick={(event) => {
            event.stopPropagation();
            if (audioPreview.assetId === asset.id) audioPreview.stop();
            else audioPreview.playClip(asset.id);
          }}
          className="absolute bottom-0.5 right-0.5 rounded-sm bg-surface-2/80 p-1 text-ink-dim opacity-0 hover:text-accent group-hover:opacity-100"
        >
          <Play size={11} />
        </button>
      )}

      <button
        type="button"
        title="Delete asset"
        onClick={onRemove}
        className="absolute right-0.5 top-0.5 rounded-sm bg-surface-2/80 p-1 text-ink-dim opacity-0 hover:text-error group-hover:opacity-100"
      >
        <Trash2 size={11} />
      </button>
      <button
        type="button"
        title="Reveal in file manager"
        onClick={() => void window.studio.assets.revealInFileManager(asset.path)}
        className="absolute left-0.5 top-0.5 rounded-sm bg-surface-2/80 p-1 text-ink-dim opacity-0 hover:text-ink group-hover:opacity-100"
      >
        {/* Same icon as the list row: one action, one look, wherever it appears. */}
        <FolderOpen size={11} />
      </button>
    </div>
  );
}

function AssetList({
  assets,
  folders,
  sortKey,
  onSort,
  onOpenFolder,
  revealed,
  onRemove,
}: {
  assets: AssetEntry[];
  folders: string[];
  sortKey: AssetSortKey;
  onSort: (key: AssetSortKey) => void;
  onOpenFolder: (folder: string) => void;
  revealed: string | null;
  onRemove: (assetPath: string) => void;
}) {
  const columns: readonly { key: AssetSortKey; label: string; className: string }[] = [
    { key: 'name', label: 'Name', className: 'flex-1' },
    { key: 'kind', label: 'Type', className: 'w-16' },
    { key: 'sizeBytes', label: 'Size', className: 'w-16 text-right' },
    { key: 'importedAt', label: 'Imported', className: 'w-20 text-right' },
  ];

  return (
    <div className="text-2xs">
      <div className="flex gap-2 border-b border-line px-2 py-1 text-ink-dim">
        {columns.map((column) => (
          <button
            key={column.key}
            type="button"
            onClick={() => onSort(column.key)}
            className={`${column.className} text-left hover:text-ink ${sortKey === column.key ? 'text-ink' : ''}`}
          >
            {column.label}
          </button>
        ))}
        {/* Reserves the row-action gutter so the columns line up with the rows. */}
        <span className="w-10" />
      </div>

      {folders.map((path) => (
        <div key={path} className="group flex items-center gap-2 px-2 py-1 hover:bg-surface-2">
          <button
            type="button"
            onClick={() => onOpenFolder(path)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <Folder size={12} className="shrink-0 text-warn" />
            <span className="min-w-0 flex-1 truncate text-ink">{path.split('/').pop()}</span>
          </button>
          <button
            type="button"
            title="Rename folder"
            onClick={() => void renameFolder(path)}
            className="w-5 text-ink-dim opacity-0 hover:text-ink group-hover:opacity-100"
          >
            <Pencil size={11} />
          </button>
          <button
            type="button"
            title="Delete folder"
            onClick={() => void deleteFolder(path)}
            className="w-5 text-ink-dim opacity-0 hover:text-error group-hover:opacity-100"
          >
            <Trash2 size={11} />
          </button>
        </div>
      ))}

      {assets.map((asset) => {
        const Icon = KIND_ICON[asset.kind];
        return (
          <div
            key={asset.id}
            draggable
            onDragStart={(event) => setAssetDragPayload(event.dataTransfer, asset)}
            ref={(element) => {
              if (asset.id === revealed) element?.scrollIntoView({ block: 'nearest' });
            }}
            className={`group flex items-center gap-2 px-2 py-1 hover:bg-surface-2 ${
              asset.id === revealed ? 'bg-accent-dim' : ''
            }`}
          >
            <Icon size={12} className="shrink-0 text-ink-muted" />
            <span className="min-w-0 flex-1 truncate text-ink">{asset.name}</span>
            <span className="w-16 capitalize text-ink-dim">{asset.kind}</span>
            <span className="w-16 text-right text-ink-dim">{formatBytes(asset.sizeBytes)}</span>
            <span className="w-20 text-right text-ink-dim">
              {new Date(asset.importedAt).toLocaleDateString()}
            </span>
            <button
              type="button"
              title="Reveal in file manager"
              onClick={() => void window.studio.assets.revealInFileManager(asset.path)}
              className="w-5 text-ink-dim opacity-0 hover:text-ink group-hover:opacity-100"
            >
              <FolderOpen size={11} />
            </button>
            <button
              type="button"
              title="Delete asset"
              onClick={() => onRemove(asset.path)}
              className="w-5 text-ink-dim opacity-0 hover:text-error group-hover:opacity-100"
            >
              <Trash2 size={11} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A clip's length, channels and rate, when the sidecar knows them.
 *
 * `null` rather than a placeholder: a file adopted by the scan never went
 * through the dialog that decodes it, and there is no `decodeAudioData` under
 * Node for the main process to fill the gap with (ADR-6). Saying nothing is the
 * honest answer, and the numbers appear the day the file is imported properly.
 */
function audioLine(asset: AssetEntry): string | null {
  const settings = asset.settings;
  if (settings.kind !== 'audio' || settings.seconds === undefined) return null;
  const seconds = Math.max(0, settings.seconds);
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  const parts = [`${minutes}:${String(rest).padStart(2, '0')}`];
  if (settings.channels !== undefined) parts.push(settings.channels === 1 ? 'mono' : 'stereo');
  if (settings.sampleRate !== undefined) parts.push(`${Math.round(settings.sampleRate / 1000)} kHz`);
  return parts.join(' · ');
}
