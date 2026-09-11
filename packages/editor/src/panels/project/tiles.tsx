import { assetUrl, hasImagePreview, type AssetEntry } from '@three-studio/core';
import {
  FolderOpen,
  Folder,
  Pencil,
  Play,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { deleteFolder, renameFolder } from '../../commands/assetCommands';
import { commandById, contextForAsset } from '../../commands/registry';
import { ASSET_PATH_MIME, setAssetDragPayload } from '../../assets/assetDrag';
import { clipPeaks } from '../../audio/peaks';
import { audioPreview } from '../../audio/preview';
import { drawPeaks } from '../../audio/waveform';
import { useAssetStore } from '../../state/assetStore';
import { usePrefabModeStore } from '../../state/prefabModeStore';
import { KIND_ICON, audioLine, formatBytes } from './kinds';

/**
 * One folder in the grid, and a drop target for an asset dragged onto it.
 *
 * `memo`, and it takes no callbacks — the two go together. A tile handed
 * `onOpen={() => store.setFolder(path)}` is handed a new function on every
 * render of the panel, which is every keystroke in the search box, and `memo`
 * then compares two different functions and re-renders anyway. Reaching the
 * store here costs nothing and is what makes the memo real.
 */
export const FolderTile = memo(function FolderTile({ path }: { path: string }) {
  const [over, setOver] = useState(false);
  const onOpen = () => useAssetStore.getState().setFolder(path);
  const onDropAsset = (assetPath: string) => void useAssetStore.getState().move(assetPath, path);
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
});

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

/**
 * One asset in the grid.
 *
 * `memo` and no callbacks, for the reason on `FolderTile`: typing in the search
 * box re-renders the panel, and a tile that survives the new filter must not
 * re-render with it. `asset` keeps its identity across a filter change — it
 * comes out of the manifest — so the comparison is cheap and true.
 */
export const AssetTile = memo(function AssetTile({
  asset,
  revealed,
}: {
  asset: AssetEntry;
  revealed: boolean;
}) {
  const onRemove = () => commandById('deleteAsset').run(contextForAsset(asset.id));
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
  const previewUrl = hasImagePreview(asset) ? assetUrl(asset.path) : null;

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
});
