import { importerForFile } from '@three-studio/core';
import { ChevronRight, CornerLeftUp, Folder, FolderPlus, Pencil, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { createFolder, deleteFolder, renameFolder } from '../commands/assetCommands';
import { childFolders, useAssetStore } from '../state/assetStore';
import { useImportStore } from './importStore';
import type { ImportRow } from './plan';

const ACTION = 'w-5 shrink-0 text-ink-dim opacity-0 group-hover:opacity-100';

/**
 * Where the batch lands, browsed rather than typed.
 *
 * The destination used to be a text field with a datalist behind it, which
 * meant naming a folder without being able to see what was in it — and creating
 * one only in whatever the Project panel happened to be showing. This browses
 * the real thing: folders are navigable, the assets already there are shown but
 * inert, and the folder being aimed at can be made, renamed or removed on the
 * spot.
 */
export function DestinationBrowser({ rows }: { rows: readonly ImportRow[] }) {
  const manifest = useAssetStore((state) => state.manifest);
  const folder = useImportStore((state) => state.folder);
  const browsePath = useImportStore((state) => state.browsePath);
  const store = useImportStore;

  const folders = useMemo(() => childFolders(manifest, browsePath), [manifest, browsePath]);
  const files = useMemo(
    () => manifest.assets.filter((asset) => asset.folder === browsePath),
    [manifest, browsePath],
  );

  // What is about to be written here, so a file that will be suffixed says so
  // beside the one it collides with rather than after the import. Only while
  // the browser is showing the destination — elsewhere nothing is landing.
  const incoming = useMemo(
    () =>
      browsePath === folder
        ? new Set(rows.filter((row) => row.included).map((row) => row.file.fileName))
        : new Set<string>(),
    [rows, browsePath, folder],
  );

  const parent = browsePath.includes('/')
    ? browsePath.slice(0, browsePath.lastIndexOf('/'))
    : '';

  return (
    <div className="flex h-56 shrink-0 flex-col border-t border-line bg-surface-0/40">
      <AutoRow active={folder === ''} onPick={() => store.getState().setFolder('')} />

      <div className="flex shrink-0 items-center gap-0.5 border-b border-line px-2 py-1 text-2xs text-ink-muted">
        <Crumb label="Assets" active={browsePath === ''} onClick={() => store.getState().browse('')} />
        {crumbsOf(browsePath).map((crumb) => (
          <span key={crumb.path} className="flex items-center gap-0.5">
            <ChevronRight size={10} className="text-ink-dim" />
            <Crumb
              label={crumb.label}
              active={crumb.path === browsePath}
              onClick={() => store.getState().browse(crumb.path)}
            />
          </span>
        ))}
        <button
          type="button"
          title="New folder here"
          onClick={() => void newFolder(browsePath)}
          className="ml-auto flex items-center gap-1 text-ink-dim hover:text-ink"
        >
          <FolderPlus size={12} />
          New folder
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-0.5">
        {browsePath !== '' && (
          <button
            type="button"
            onClick={() => store.getState().browse(parent)}
            className="flex w-full items-center gap-2 px-2 py-1 text-left text-2xs text-ink-dim hover:bg-surface-2"
          >
            <CornerLeftUp size={12} className="shrink-0" />
            <span className="flex-1 truncate">{parent === '' ? 'Assets' : parent.split('/').pop()}</span>
          </button>
        )}

        {folders.map((path) => (
          <FolderRow
            key={path}
            path={path}
            selected={path === folder}
            count={countIn(manifest.assets, path)}
          />
        ))}

        {files.map((asset) => {
          const fileName = asset.path.split('/').pop() ?? asset.path;
          const collides = incoming.has(fileName);
          return (
            <div
              key={asset.id}
              title={
                collides
                  ? `An incoming file is called ${fileName} too, so it will be imported under a suffixed name`
                  : undefined
              }
              className="flex cursor-default items-center gap-2 px-2 py-1 text-2xs text-ink-dim"
            >
              <span className="w-3 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{fileName}</span>
              {collides && <span className="shrink-0 text-warn">name taken</span>}
              <span className="w-10 shrink-0" />
            </div>
          );
        })}

        {folders.length === 0 && files.length === 0 && (
          <p className="px-2 py-2 text-2xs text-ink-dim">This folder is empty.</p>
        )}
      </div>

      <Summary rows={rows} folder={folder} />
    </div>
  );
}

/** The old empty destination, said out loud. */
function AutoRow({ active, onPick }: { active: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={`flex shrink-0 items-center gap-2 border-b border-line px-2 py-1.5 text-left text-2xs ${
        active ? 'bg-accent-dim text-ink' : 'text-ink-muted hover:bg-surface-2'
      }`}
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full border ${
          active ? 'border-accent bg-accent' : 'border-line-soft'
        }`}
      />
      Automatic
      <span className="text-ink-dim">— each format under the folder its importer names</span>
    </button>
  );
}

function Crumb({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className={active ? 'text-ink' : 'hover:text-ink'}>
      {label}
    </button>
  );
}

function FolderRow({
  path,
  selected,
  count,
}: {
  path: string;
  selected: boolean;
  count: number;
}) {
  const store = useImportStore;

  return (
    <div
      className={`group flex items-center gap-2 px-2 py-1 text-2xs ${
        selected ? 'bg-accent-dim' : 'hover:bg-surface-2'
      }`}
    >
      <button
        type="button"
        onClick={() => store.getState().enterFolder(path)}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <Folder size={12} className="shrink-0 text-warn" />
        <span className="min-w-0 flex-1 truncate text-ink">{path.split('/').pop()}</span>
        {count > 0 && <span className="shrink-0 text-ink-dim">{count}</span>}
      </button>
      <button
        type="button"
        title="Rename folder"
        onClick={() => void rename(path)}
        className={`${ACTION} hover:text-ink`}
      >
        <Pencil size={11} />
      </button>
      <button
        type="button"
        title="Delete folder"
        onClick={() => void remove(path)}
        className={`${ACTION} hover:text-error`}
      >
        <Trash2 size={11} />
      </button>
    </div>
  );
}

/** Says where the files are actually going, Automatic included. */
function Summary({ rows, folder }: { rows: readonly ImportRow[]; folder: string }) {
  const included = rows.filter((row) => row.included);
  const bringsCompanions = included.some((row) => row.file.companions.length > 0);

  const targets =
    folder === ''
      ? [
          ...new Set(
            included.map((row) => importerForFile(row.file.fileName)?.directory ?? 'assets'),
          ),
        ].sort()
      : [folder];

  return (
    <p className="shrink-0 truncate border-t border-line px-2 py-1 text-2xs text-ink-dim">
      {included.length === 0
        ? 'Nothing selected to import'
        : `${included.length} file${included.length === 1 ? '' : 's'} → ${targets
            .map((target) => `assets/${target}`)
            .join(', ')}`}
      {bringsCompanions && (
        <span className="text-ink-muted">
          {' · '}a model that brings files with it gets a folder of its own
        </span>
      )}
    </p>
  );
}

function crumbsOf(path: string): { label: string; path: string }[] {
  if (path === '') return [];
  const segments = path.split('/');
  return segments.map((label, index) => ({ label, path: segments.slice(0, index + 1).join('/') }));
}

function countIn(assets: readonly { folder: string }[], path: string): number {
  const prefix = `${path}/`;
  return assets.filter((asset) => asset.folder === path || asset.folder.startsWith(prefix)).length;
}

/** Creates below the browsed folder and moves both there, whatever it got named. */
async function newFolder(parent: string): Promise<void> {
  const created = await createFolder(parent);
  if (created !== null) useImportStore.getState().enterFolder(created);
}

/** Both paths follow the folder, so neither is left naming something gone. */
async function rename(path: string): Promise<void> {
  const renamed = await renameFolder(path);
  if (renamed !== null) useImportStore.getState().followFolder(path, renamed);
}

async function remove(path: string): Promise<void> {
  if (await deleteFolder(path)) useImportStore.getState().followFolder(path, null);
}
