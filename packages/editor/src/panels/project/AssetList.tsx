import type { AssetEntry } from '@three-studio/core';
import { Folder, FolderOpen, Pencil, Trash2 } from 'lucide-react';
import { deleteFolder, renameFolder } from '../../commands/assetCommands';
import { commandById, contextForAsset } from '../../commands/registry';
import { setAssetDragPayload } from '../../assets/assetDrag';
import { useAssetStore, type AssetSortKey } from '../../state/assetStore';
import { KIND_ICON, formatBytes } from './kinds';

/**
 * The same assets as a table, for the times a name and a size matter more than
 * a thumbnail.
 *
 * Not memoised, unlike the tiles: this is one component drawing every row, so
 * there is nothing for a memo to spare. It reaches the store for its actions
 * for the same reason they do.
 */
export function AssetList({
  assets,
  folders,
  sortKey,
  revealed,
}: {
  assets: AssetEntry[];
  folders: string[];
  sortKey: AssetSortKey;
  revealed: string | null;
}) {
  const onSort = useAssetStore((s) => s.setSort);
  const onOpenFolder = useAssetStore((s) => s.setFolder);
  const onRemove = (asset: AssetEntry) =>
    commandById('deleteAsset').run(contextForAsset(asset.id));
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
              onClick={() => onRemove(asset)}
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
