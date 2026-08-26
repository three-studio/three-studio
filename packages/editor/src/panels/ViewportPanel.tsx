import { createAudioSourceEntity, createModelEntity, variantBaseOf } from '@three-studio/core';
import { Boxes, ChevronLeft } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { addEntity } from '../commands/sceneCommands';
import { useAssetStore } from '../state/assetStore';
import { usePrefabModeStore } from '../state/prefabModeStore';
import { useEditorStore } from '../state/editorStore';
import { useViewportStore } from '../state/viewportStore';
import { acquireViewport, peekViewport } from '../viewport/viewportHost';
import { ASSET_DRAG_MIME, assetKindMime } from '../assets/assetDrag';
import { instantiatePrefab } from '../commands/prefabCommands';

export function ViewportPanel() {
  const hostRef = useRef<HTMLDivElement>(null);
  const error = useViewportStore((s) => s.error);
  const playState = useEditorStore((s) => s.playState);
  const [dropping, setDropping] = useState(false);

  useEffect(() => {
    // While the game runs the canvas belongs to the Game panel; claiming it
    // here would leave the player looking at an idle editor view.
    if (playState !== 'stopped') return;
    let cancelled = false;

    void acquireViewport()
      .then((viewport) => {
        if (cancelled || !hostRef.current) return;
        viewport.attach(hostRef.current);
      })
      .catch((cause: unknown) => {
        useViewportStore
          .getState()
          .setError(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      cancelled = true;
      // The canvas is shared and outlives this component, so hand it back
      // rather than leaving it parented to a container React is about to drop.
      peekViewport()?.detach();
    };
  }, [playState]);

  if (error) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-surface-1 px-6 text-center">
        <p className="text-error">The renderer failed to start.</p>
        <p className="text-2xs text-ink-muted" data-selectable>
          {error}
        </p>
      </div>
    );
  }

  /** Dropping a model from the Project panel places it where the cursor is. */
  const onDrop = (event: DragEvent) => {
    // A prefab and a model both arrive as an asset id; which one it is decides
    // whether the scene gets an instance or a mesh.
    const assetId = event.dataTransfer.getData(ASSET_DRAG_MIME);
    setDropping(false);
    if (!assetId) return;
    event.preventDefault();

    const viewport = peekViewport();
    if (!viewport) return;
    const point = viewport.dropPoint(event.clientX, event.clientY);

    // A prefab and a model both arrive as an asset id; which one it is decides
    // whether the scene gets an instance or a mesh.
    if (event.dataTransfer.types.includes(assetKindMime('prefab'))) {
      instantiatePrefab(assetId, [point.x, point.y, point.z]);
      return;
    }

    const asset = useAssetStore.getState().byId(assetId);
    if (!asset) return;

    // Every kind that is not a prefab used to fall through to a model, so a
    // `.wav` dropped here produced a model entity pointing at a sound — an
    // entity that could never load anything and said nothing about why.
    const template =
      asset.kind === 'audio'
        ? createAudioSourceEntity(assetId, asset.name)
        : createModelEntity(assetId, asset.name);
    // Positioned before insertion so the drop is a single undo step.
    template.entity.transform.position = [point.x, point.y, point.z];
    addEntity(template);
  };

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-surface-0"
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(ASSET_DRAG_MIME)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
    >
      <PrefabModeBar />
      {/* The canvas is inserted here by EditorViewport.attach and is shared
          with the Game panel, so it is never rendered by React. */}
      <div ref={hostRef} className="absolute inset-0" />
      <ViewportStats />
      {dropping && (
        <div className="pointer-events-none absolute inset-2 rounded-sm border-2 border-dashed border-accent" />
      )}
    </div>
  );
}

function ViewportStats() {
  const backend = useViewportStore((s) => s.backend);
  const fps = useViewportStore((s) => s.fps);
  const drawCalls = useViewportStore((s) => s.drawCalls);
  const triangles = useViewportStore((s) => s.triangles);
  const flySpeed = useViewportStore((s) => s.flySpeed);

  return (
    <div className="pointer-events-none absolute right-2 top-2 rounded-sm border border-line-soft/60 bg-surface-0/75 px-2 py-1.5 font-mono text-2xs text-ink-muted backdrop-blur-sm">
      <div className="flex justify-between gap-4">
        <span>Backend</span>
        <span className={backend === 'webgpu' ? 'text-play' : 'text-warn'}>
          {backend?.toUpperCase() ?? '…'}
        </span>
      </div>
      <div className="flex justify-between gap-4">
        <span>FPS</span>
        <span className="text-ink">{fps}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span>Draw calls</span>
        <span className="text-ink">{drawCalls}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span>Tris</span>
        <span className="text-ink">{triangles.toLocaleString()}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span>Fly</span>
        <span className="text-ink">{flySpeed.toFixed(1)} m/s</span>
      </div>
    </div>
  );
}

/**
 * The trail of prefabs that are open, and how to get back out of any of them.
 *
 * The only thing on screen that distinguishes Prefab Mode from an ordinary
 * scene — everything else looks the same because it *is* the same, a document
 * in the same editor. Unity tints the view and puts the same breadcrumb across
 * the top: a mode you cannot see you are in is a mode you will save the wrong
 * thing from.
 */
function PrefabModeBar() {
  const stack = usePrefabModeStore((s) => s.stack);
  const closeTo = usePrefabModeStore((s) => s.closeTo);
  const prefabs = useAssetStore((s) => s.prefabs);

  if (stack.length === 0) return null;

  const deepest = stack.at(-1)!;
  const base = prefabs[deepest.assetId] ? variantBaseOf(prefabs[deepest.assetId]!) : null;
  const baseName = base ? (prefabs[base]?.name ?? 'a missing prefab') : null;

  return (
    <div className="absolute inset-x-0 top-0 z-10 flex h-7 items-center gap-1 border-b border-prefab/40 bg-prefab/15 px-2 backdrop-blur-sm">
      <button
        type="button"
        onClick={() => void closeTo(0)}
        title="Back to the scene — every prefab is saved on the way out"
        className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-2xs text-ink-muted hover:bg-surface-3 hover:text-ink"
      >
        <ChevronLeft size={12} />
        Scene
      </button>

      {stack.map((frame, index) => {
        const last = index === stack.length - 1;
        return (
          <span key={frame.assetId} className="flex items-center gap-1">
            <span className="text-ink-dim">/</span>
            <Boxes size={12} className="text-prefab" />
            {last ? (
              <span className="text-2xs text-ink">{frame.name}</span>
            ) : (
              <button
                type="button"
                // Leaving to a frame saves everything below it, so clicking a
                // crumb is a way back rather than a way to lose work.
                onClick={() => void closeTo(index + 1)}
                className="rounded-sm px-1 py-0.5 text-2xs text-ink-muted hover:bg-surface-3 hover:text-ink"
              >
                {frame.name}
              </button>
            )}
          </span>
        );
      })}

      {baseName !== null && <span className="text-2xs text-ink-dim">· variant of {baseName}</span>}
      <span className="ml-auto text-2xs text-ink-dim">Saved when you leave</span>
    </div>
  );
}
