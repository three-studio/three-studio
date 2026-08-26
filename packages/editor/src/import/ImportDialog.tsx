import {
  importPreviewUrl,
  type AssetKind,
  type ImportField,
  type StagedFile,
} from '@three-studio/core';
import {
  AlertTriangle,
  Box,
  Boxes,
  Copy,
  FileCode,
  FileQuestion,
  Image,
  Palette,
  Sparkles,
  Volume2,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DialogFrame } from '../ui/DialogFrame';
import { DestinationBrowser } from './DestinationBrowser';
import { fieldsFor, useImportStore } from './importStore';
import type { ImportRow } from './plan';
import { summarise } from './plan';
import { describeFacts, formatBytes, formatUnits, hasPreview } from './preview/facts';
import { previewFor, type PreviewSurface } from './preview/PreviewSurface';
import { ImportSettingsPane, type SettingsDraft } from './settingsPane';

const KIND_ICON: Record<AssetKind, LucideIcon> = {
  model: Box,
  texture: Image,
  material: Palette,
  prefab: Boxes,
  shader: Sparkles,
  audio: Volume2,
  script: FileCode,
};

const BUTTON =
  'rounded-xs border border-line-soft px-2.5 py-1 text-2xs text-ink-muted hover:bg-surface-3 hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent';
const PRIMARY =
  'rounded-xs bg-accent px-3 py-1 text-2xs text-white hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100';

/**
 * The dialog everything is imported through.
 *
 * Mounted once near the root and shown whenever a session is open, the way the
 * prompt and confirm dialogs are. Nothing it shows exists in the project yet:
 * the files are still where the author left them, and the settings are a draft
 * until the button at the bottom right is pressed.
 */
export function ImportDialog() {
  const sessionId = useImportStore((state) => state.sessionId);
  if (sessionId === null) return null;
  return <ImportDialogBody sessionId={sessionId} />;
}

function ImportDialogBody({ sessionId }: { sessionId: string }) {
  const rows = useImportStore((state) => state.rows);
  const selectedId = useImportStore((state) => state.selectedId);
  const busy = useImportStore((state) => state.busy);
  const error = useImportStore((state) => state.error);
  const store = useImportStore;

  const selected = rows.find((row) => row.file.id === selectedId) ?? null;
  const counts = useMemo(() => summarise(rows), [rows]);
  const canApplyToAll =
    selected !== null &&
    rows.some(
      (row) =>
        row.file.id !== selected.file.id && row.file.importerId === selected.file.importerId,
    );

  return (
    <DialogFrame
      title="Import assets"
      onClose={() => store.getState().cancel()}
      // As much of the window as it can have: a preview boxed into 256 px was
      // the thing the dialog exists for, shown at the size of a thumbnail.
      fillsWindow
      footer={
        <>
          <button
            type="button"
            className={`${BUTTON} mr-auto`}
            disabled={!canApplyToAll}
            title="Copies these settings onto every other file of the same format"
            onClick={() => selected && store.getState().applyToAll(selected.file.id)}
          >
            Apply to all {selected?.file.formatLabel.toLowerCase()}
          </button>
          <button
            type="button"
            className={BUTTON}
            disabled={selected === null || selected.settings === null}
            onClick={() => selected && store.getState().reset(selected.file.id)}
          >
            Reset
          </button>
          <button type="button" className={BUTTON} onClick={() => store.getState().cancel()}>
            Cancel
          </button>
          <button
            type="button"
            className={PRIMARY}
            disabled={busy || counts.included === 0}
            onClick={() => void store.getState().confirm()}
          >
            {busy
              ? 'Importing…'
              : `Import ${counts.included} asset${counts.included === 1 ? '' : 's'}`}
          </button>
        </>
      }
    >
      <div className="flex min-h-0 w-full flex-col">
        {error && (
          <p className="border-b border-line bg-error/10 px-3 py-1.5 text-2xs text-error">
            {error}
          </p>
        )}
        {/*
          Three columns: what is coming in, what it looks like and where it
          lands, and what it is being imported as. The destination stays under
          the preview whether or not a file is selected — it is a property of
          the batch, not of the row.
        */}
        <div className="flex min-h-0 flex-1">
          <FileList rows={rows} selectedId={selectedId} counts={counts} />

          <div className="flex min-w-0 flex-1 flex-col">
            {selected ? (
              <>
                <Preview key={selected.file.id} sessionId={sessionId} row={selected} />
                <FactsLine row={selected} />
              </>
            ) : (
              <Empty />
            )}
            <DestinationBrowser rows={rows} />
          </div>

          <div className="flex w-80 shrink-0 flex-col border-l border-line">
            {selected ? <SettingsColumn row={selected} /> : <Empty />}
          </div>
        </div>
      </div>
    </DialogFrame>
  );
}

function FileList({
  rows,
  selectedId,
  counts,
}: {
  rows: readonly ImportRow[];
  selectedId: string | null;
  counts: ReturnType<typeof summarise>;
}) {
  const store = useImportStore;
  const allOn = counts.included === counts.importable && counts.importable > 0;

  return (
    <div className="flex w-72 shrink-0 flex-col border-r border-line bg-surface-0/40">
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {rows.map((row) => (
          <FileRow key={row.file.id} row={row} selected={row.file.id === selectedId} />
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-line px-2.5 py-1.5">
        <button
          type="button"
          className="text-2xs text-ink-dim hover:text-ink"
          onClick={() => store.getState().toggleAll(!allOn)}
          disabled={counts.importable === 0}
        >
          {allOn ? 'None' : 'All'}
        </button>
        <span className="text-2xs text-ink-dim">
          {counts.included} of {counts.importable} selected
          {counts.unsupported > 0 && ` · ${counts.unsupported} unsupported`}
        </span>
      </div>
    </div>
  );
}

function FileRow({ row, selected }: { row: ImportRow; selected: boolean }) {
  const store = useImportStore;
  const supported = row.file.importerId !== null;
  const Icon = row.file.kind ? KIND_ICON[row.file.kind] : FileQuestion;

  return (
    <div
      className={`flex cursor-default items-center gap-2 px-2.5 py-1 ${
        selected ? 'bg-accent-dim' : 'hover:bg-surface-2'
      }`}
      onPointerDown={() => store.getState().select(row.file.id)}
    >
      <input
        type="checkbox"
        checked={row.included}
        disabled={!supported}
        onChange={() => store.getState().toggle(row.file.id)}
        onPointerDown={(event) => event.stopPropagation()}
        className="accent-accent"
      />
      <Icon size={12} className={supported ? 'text-ink-muted' : 'text-ink-dim'} />
      <span className={`min-w-0 flex-1 truncate text-2xs ${supported ? 'text-ink' : 'text-ink-dim'}`}>
        {row.file.fileName}
      </span>
      <RowBadge file={row.file} />
    </div>
  );
}

function RowBadge({ file }: { file: StagedFile }) {
  if (file.importerId === null) {
    return (
      <span title="Nothing imports this format" className="text-ink-dim">
        <AlertTriangle size={11} />
      </span>
    );
  }
  if (file.conflict?.kind === 'duplicate') {
    return (
      <span
        title={`Already in the project as ${file.conflict.existingPath}`}
        className="text-warn"
      >
        <Copy size={11} />
      </span>
    );
  }
  if (file.conflict?.kind === 'name') {
    return (
      <span
        title={`${file.conflict.existingPath} has this name; the copy will be numbered`}
        className="text-ink-dim"
      >
        <AlertTriangle size={11} />
      </span>
    );
  }
  return <span className="text-2xs text-ink-dim">{file.formatLabel}</span>;
}

function Empty() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <p className="text-2xs text-ink-dim">Nothing selected</p>
    </div>
  );
}

/** The right column: the importer's own fields, laid out like the inspector. */
function SettingsColumn({ row }: { row: ImportRow }) {
  const fields = useMemo(() => fieldsFor(row), [row.file.id, row.settings === null]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
      {row.settings === null ? (
        <p className="p-3 text-2xs text-ink-dim">
          No importer claims <span className="text-ink-muted">{row.file.fileName}</span>. It will be
          left where it is.
        </p>
      ) : (
        <Settings row={row} fields={fields} />
      )}
    </div>
  );
}

/**
 * Mounts the preview for the selected file and tears it down when it changes.
 *
 * `key`ed on the file id one level up, so switching rows remounts rather than
 * trying to talk a WebGPU renderer into becoming an `<audio>` element.
 */
function Preview({ sessionId, row }: { sessionId: string; row: ImportRow }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<PreviewSurface | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null || !hasPreview(row.file.kind)) return;

    let cancelled = false;
    void (async () => {
      const surface = await previewFor(row.file.kind);
      if (surface === null) return;
      if (cancelled) {
        surface.dispose();
        return;
      }
      surfaceRef.current = surface;
      try {
        const facts = await surface.open(container, importPreviewUrl(sessionId, row.file));
        if (cancelled) return;
        useImportStore.getState().setFacts(facts);
        // The settings as they stand, so a model opens already scaled rather
        // than snapping into place on the first edit.
        if (row.settings) surface.update?.(row.settings);
      } catch (cause) {
        console.warn('[import] preview failed', cause);
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      surfaceRef.current?.dispose();
      surfaceRef.current = null;
    };
  }, [sessionId, row.file.id, row.file.kind]);

  // Settings change far more often than the file does, so this is a separate
  // effect: reloading a 40 MB FBX on every drag of the scale field is not a
  // preview, it is a stall.
  useEffect(() => {
    if (row.settings) surfaceRef.current?.update?.(row.settings);
  }, [row.settings]);

  if (!hasPreview(row.file.kind) || failed) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center border-b border-line bg-surface-0/60">
        <p className="text-2xs text-ink-dim">
          {failed ? 'This file could not be opened' : 'No preview for this kind'}
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative min-h-0 flex-1 overflow-hidden border-b border-line bg-surface-0/60"
    />
  );
}

/**
 * The line that makes the dialog worth opening.
 *
 * For a model it ends in the bounding box *and what the current scale makes of
 * it*: 2746 units is a number, and "27.5 m at ×0.01" is the answer to the
 * question the author actually has.
 */
function FactsLine({ row }: { row: ImportRow }) {
  const facts = useImportStore((state) => state.facts);
  const summary = describeFacts(facts);
  const scale = row.settings?.kind === 'model' ? row.settings.scale : null;
  const size = facts?.kind === 'model' ? facts.size : null;

  return (
    <div className="shrink-0 border-b border-line px-3 py-1.5">
      <p className="truncate text-2xs text-ink">
        {row.file.fileName}
        <span className="text-ink-dim"> · {formatBytes(row.file.sizeBytes)}</span>
        {summary && <span className="text-ink-muted"> · {summary}</span>}
      </p>
      {size && scale !== null && (
        <p className="text-2xs text-ink-dim">
          bounds {size.map(formatUnits).join(' × ')}
          <span className="text-ink-muted">
            {' → '}
            {formatUnits(Math.max(...size) * scale)} m at ×{scale}
          </span>
        </p>
      )}
      {row.file.companions.length > 0 && (
        <p className="truncate text-2xs text-ink-dim" title={row.file.companions.join('\n')}>
          brings {row.file.companions.length} file
          {row.file.companions.length === 1 ? '' : 's'} with it
        </p>
      )}
    </div>
  );
}

/** The importer's declared fields, rendered by the inspector's own binder. */
function Settings({ row, fields }: { row: ImportRow; fields: readonly ImportField[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<ImportSettingsPane | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null || row.settings === null) return;

    const pane = new ImportSettingsPane(
      container,
      fields,
      { ...row.settings },
      (settings) => useImportStore.getState().editSettings(row.file.id, settings as SettingsDraft),
      (key) => useImportStore.getState().runAction(row.file.id, key),
    );
    paneRef.current = pane;
    return () => {
      paneRef.current = null;
      pane.dispose();
    };
  }, [row.file.id, fields]);

  // "Fit to 1 m" and "Apply to all" change the values from outside the pane, and
  // the pane is bound to its own copy — without this it goes on showing the
  // number the author did not choose.
  useEffect(() => {
    if (row.settings) paneRef.current?.adopt({ ...row.settings });
  }, [row.settings]);

  return <div ref={containerRef} />;
}
