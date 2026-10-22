import { variantBaseOf } from '@three-studio/core';
import { Boxes, ChevronLeft, MousePointerClick, TriangleAlert } from 'lucide-react';
import type { IDockviewPanelProps } from 'dockview-react';
import { useEffect, useRef, useState, type DragEvent, type RefObject } from 'react';
import { DROPPABLE_KINDS, placeDroppedAsset } from '../commands/placeEntity';
import { commandById } from '../commands/registry';
import { shortcutHint } from '../shell/shortcutBindings';
import { useAssetStore } from '../state/assetStore';
import { useEditorStore } from '../state/editorStore';
import { usePrefabModeStore } from '../state/prefabModeStore';
import { useViewportStore } from '../state/viewportStore';
import { acquireViewport, peekViewport } from '../viewport/viewportHost';
import { viewState } from '../viewport/viewState';
import { ASSET_DRAG_MIME, assetKindMime } from '../assets/assetDrag';
import { SceneToolbar } from './SceneToolbar';
import { tooltip } from '../ui/Tooltip';

/**
 * The Keyboard Lock API, which TypeScript's DOM library does not carry: only
 * Chromium ships it, and Electron is Chromium.
 */
interface KeyboardLock {
  lock(keyCodes?: string[]): Promise<void>;
  unlock(): void;
}

function keyboardLock(): KeyboardLock | undefined {
  return (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;
}

/** How long the full-screen hint stays before it fades, in milliseconds. */
const FULL_SCREEN_HINT_MS = 4000;

/**
 * Where the scene is edited and the game is played.
 *
 * One panel for both, as Unreal plays in the level viewport: the edit view
 * while stopped, the game during Play, in the same place. Each has a canvas of
 * its own, stacked on the stage, and `viewState` says which one is on top. Their
 * own canvas, but not their own renderer: a second `WebGPURenderer` in the same
 * document would destroy this one's output target every frame. The one renderer
 * draws whichever view is on top and hands its canvas a copy — see
 * `Presentation`.
 */
export function ViewportPanel(props: IDockviewPanelProps) {
  // What the box cannot say: dockview parks an inactive tab at full size, so a
  // hidden panel goes on being drawn unless something tells the viewport. The
  // dock is the only thing that knows, and it publishes it here, for both of
  // the views this tab holds.
  useEffect(() => {
    const push = (onScreen: boolean) => void acquireViewport().then((v) => v.setOnScreen(onScreen));
    push(props.api.isVisible);
    const sub = props.api.onDidVisibilityChange((event) => push(event.isVisible));
    return () => sub.dispose();
  }, [props.api]);

  const stageRef = useRef<HTMLDivElement>(null);
  const editHostRef = useRef<HTMLDivElement>(null);
  const gameHostRef = useRef<HTMLDivElement>(null);
  const rendererError = useViewportStore((s) => s.rendererError);
  const showStats = useEditorStore((s) => s.showStats);
  const playState = useEditorStore((s) => s.playState);
  // A boolean, so the panel renders when the game's first frame is in and at
  // Stop, never per frame.
  const gameShown = useViewportStore((s) => s.gameShown);
  const [dropping, setDropping] = useState(false);
  const view = viewState({ playState, gameShown });
  const holdingScreen = usePlayFullScreen(stageRef);

  useEffect(() => {
    let cancelled = false;

    void acquireViewport()
      .then((viewport) => {
        if (cancelled || !editHostRef.current || !gameHostRef.current) return;
        viewport.attach({ edit: editHostRef.current, game: gameHostRef.current });
      })
      .catch((cause: unknown) => {
        useViewportStore
          .getState()
          .setRendererError(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      cancelled = true;
      // The canvases outlive this component — a Reset Layout or a template
      // remounts the panel — so hand them back rather than leaving them
      // parented to containers React is about to drop.
      peekViewport()?.detach();
    };
    // Play state is not in here: both canvases stay on the stage for as long as
    // the panel lives, and Play changes only which one is on top. Nothing is
    // moved, re-parented or resized at the press.
  }, []);

  // The only failure that takes the view: without a renderer there is no view
  // to keep. A Play that fails is said in a toast, over the edit view.
  if (rendererError) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-surface-1 px-6 text-center">
        <p className="text-error">The renderer failed to start.</p>
        <p className="text-2xs text-ink-muted" data-selectable>
          {rendererError}
        </p>
      </div>
    );
  }

  /**
   * Dropping an asset from the Project panel places it where the cursor is.
   * What it becomes, and whether the game lets it in, is `placeDroppedAsset`'s.
   */
  const onDrop = (event: DragEvent) => {
    const assetId = event.dataTransfer.getData(ASSET_DRAG_MIME);
    setDropping(false);
    if (!assetId) return;
    event.preventDefault();

    const viewport = peekViewport();
    if (!viewport) return;
    // Measured on the edit canvas, which keeps its box on the stage during Play.
    const point = viewport.dropPoint(event.clientX, event.clientY);
    placeDroppedAsset(assetId, [point.x, point.y, point.z]);
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-surface-0">
      <SceneToolbar />
      {/* The stage: what Play Full Screen takes, the header left behind, and
          the drop target. The drop target is the canvas's box, not the
          panel's. `dropPoint` measures the pointer against the canvas, and a
          drop on the toolbar above it would be a ray above the view: the entity
          would land far off, nowhere near where it was let go. */}
      <div
        ref={stageRef}
        data-viewport-stage
        // The progress cursor while the game starts: the edit host is inert
        // then, so the stage under it is what the pointer is over.
        className={`relative min-h-0 flex-1 overflow-hidden bg-surface-0 ${view.overlays.starting ? 'cursor-progress' : ''}`}
        onDragOver={(event) => {
          // Cancelled for what the view can place, in every mode, so that its
          // drop arrives here even during Play, where `placeDroppedAsset` says
          // the refusal in the toast: a drop the browser refused on its own would
          // say nothing at all. Today the dock cancels every `dragover` over a
          // group anyway, in the capture phase, so that a panel can be docked
          // there — which is why a texture's drop arrives too, and why what a
          // drop does is decided at the drop, not here.
          //
          // What is decided here is the promise: a copy and the dashed border,
          // only for what can be placed and only while the edit view is on top,
          // where a drop places.
          const types = event.dataTransfer.types;
          if (!DROPPABLE_KINDS.some((kind) => types.includes(assetKindMime(kind)))) return;
          event.preventDefault();
          if (!view.overlays.dropTarget) return;
          event.dataTransfer.dropEffect = 'copy';
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={onDrop}
      >
        {/* The two canvases, stacked, the one on top chosen by `viewState`.
            Inserted by `EditorViewport.attach` and outliving this component,
            so neither is rendered by React.

            The one underneath is `invisible` — `visibility: hidden` — and never
            `display: none`. Both keep their box: nothing is resized when Play
            starts or stops, the game's aspect and a drop's point are measured
            against a real box, and a canvas can be drawn into before it is
            shown, which a box of zero cannot. And a hidden element takes
            neither the pointer nor the focus, so each canvas keeps to the input
            that listens on it: the edit canvas cannot be pressed or tabbed to
            while the game plays, nor the game's while the scene is edited. */}
        <div
          ref={editHostRef}
          // No pointer and no focus at the DOM from the press of Play, over the
          // guards in the code: the edit view is not the editor's to drive
          // until Stop.
          inert={view.input !== 'editor'}
          className={`absolute inset-0 ${view.canvas === 'edit' ? '' : 'invisible'}`}
        />
        <div ref={gameHostRef} className={`absolute inset-0 ${view.canvas === 'game' ? '' : 'invisible'}`} />
        {view.overlays.prefabBar && <PrefabModeBar />}
        {/* Not while the stage holds the screen: full screen is the game as a
            player sees it. */}
        {showStats && !holdingScreen && <ViewportStats editStats={view.overlays.editStats} />}
        {view.overlays.dropTarget && dropping && (
          <div className="pointer-events-none absolute inset-2 rounded-sm border-2 border-dashed border-accent" />
        )}
        {view.overlays.paused && <PausedBadge />}
        {view.overlays.problems && <SceneProblems />}
        {view.overlays.captureHint && <CaptureHint holdingScreen={holdingScreen} />}
        {view.overlays.starting && <StartingPill />}
      </div>
    </div>
  );
}

/**
 * Over the edit image, held still from the press of Play until the game's first
 * frame takes its place. It says that the picture is not the game yet, and not
 * a frozen editor either: the compile and the load are under way.
 */
function StartingPill() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span className="flex items-center gap-1.5 rounded-sm bg-surface-0/80 px-2 py-1 text-2xs text-ink-muted">
        {/* The progress toast's spinner: one way of saying "under way". */}
        <span
          className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent text-accent"
          aria-hidden
        />
        Starting…
      </span>
    </div>
  );
}

/**
 * Play Full Screen: the stage takes the whole screen, and leaving the screen
 * ends the test. Unreal's way, which is Esc there and Shift+Esc here: the stop
 * is a binding (`shortcutBindings`), and plain Esc stays the game's.
 *
 * Plain Esc would otherwise be Chromium's: it leaves full screen before the
 * page hears it. The keyboard lock hands it to the page instead, and holding it
 * for about two seconds still gets out — Chromium's own way out of a lock,
 * which lands in `onChange` like any other exit and stops the game.
 *
 * The request is made from an effect, after the click that ran Play Full Screen
 * has brought the Viewport forward — reopening it if it was closed. Chromium
 * accepts a full-screen request for a few seconds after a click, which is what
 * lets it come from an effect.
 *
 * @returns Whether the stage holds the screen right now, as the document
 *   reports it. `fullScreen` is what was asked for; this is what happened.
 */
function usePlayFullScreen(stageRef: RefObject<HTMLDivElement | null>): boolean {
  const isRunning = useEditorStore((s) => s.playState !== 'stopped');
  const fullScreen = useEditorStore((s) => s.fullScreen);
  const [holdingScreen, setHoldingScreen] = useState(false);

  useEffect(() => {
    const stage = stageRef.current;
    if (!isRunning || !fullScreen || stage === null) return;
    let ended = false;

    const onChange = () => {
      const holding = document.fullscreenElement === stage;
      setHoldingScreen(holding);
      if (!holding && useEditorStore.getState().playState !== 'stopped') commandById('stop').run();
    };
    document.addEventListener('fullscreenchange', onChange);

    stage
      .requestFullscreen()
      .then(() => {
        // Granted after the session ended: a Play that failed within the
        // request's time, which a compile error answered from cache can do in
        // milliseconds. The stage is still in the document to be granted it,
        // and nothing would give the screen back, Escape locked.
        if (ended) {
          if (document.fullscreenElement === stage) void document.exitFullscreen();
          return;
        }
        return keyboardLock()?.lock(['Escape']);
      })
      .catch((cause: unknown) => {
        // Refused: the game goes on in the Viewport, where it still plays.
        console.error('[play] full screen was refused, so the game stays in the Viewport:', cause);
      });

    return () => {
      ended = true;
      document.removeEventListener('fullscreenchange', onChange);
      keyboardLock()?.unlock();
      // How the screen is given back at Stop. The game used to have a panel of
      // its own, whose root went away with the game and took the full screen
      // with it; the stage stays, so it has to let go here.
      if (document.fullscreenElement === stage) void document.exitFullscreen();
      setHoldingScreen(false);
    };
  }, [isRunning, fullScreen, stageRef]);

  return holdingScreen;
}

/** The picture holds still while the game is paused, and this says why. */
function PausedBadge() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
      <span className="rounded-sm bg-surface-0/80 px-2 py-1 text-2xs text-warn">Paused</span>
    </div>
  );
}

/**
 * The running scene's set-up problems, placed where the eye lands rather than
 * tucked away: every one of them fails silently in the simulation.
 */
function SceneProblems() {
  const warnings = useViewportStore((s) => s.playWarnings);
  if (warnings.length === 0) return null;

  return (
    <div className="absolute left-2 top-2 max-w-md rounded-sm border border-warn/40 bg-surface-0/90 p-2">
      <div className="mb-1 flex items-center gap-1.5 text-2xs font-medium text-warn">
        <TriangleAlert size={12} />
        {warnings.length === 1 ? 'Scene problem' : `${warnings.length} scene problems`}
      </div>
      <ul className="flex flex-col gap-1">
        {warnings.map((warning) => (
          <li key={warning} className="text-2xs leading-snug text-ink-muted" data-selectable>
            {warning}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** How to give the game the mouse, and how to stop it. */
function CaptureHint({ holdingScreen }: { holdingScreen: boolean }) {
  const [shown, setShown] = useState(true);

  // Full screen is the game as a player sees it, so the hint goes after a moment.
  useEffect(() => {
    if (!holdingScreen) {
      setShown(true);
      return;
    }
    const timer = setTimeout(() => setShown(false), FULL_SCREEN_HINT_MS);
    return () => clearTimeout(timer);
  }, [holdingScreen]);

  const stopKey = shortcutHint('stop');

  return (
    <div
      className={`pointer-events-none absolute inset-x-0 bottom-2 flex justify-center transition-opacity duration-700 ${
        shown ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <span className="flex items-center gap-1.5 rounded-sm bg-surface-0/70 px-2 py-1 text-2xs text-ink-muted">
        <MousePointerClick size={11} />
        {/* Esc frees the mouse in the panel only: full screen, the keyboard
            lock gives it to the game, and the stop is the way out. */}
        {['Click to capture the mouse', holdingScreen ? null : 'Esc to release', stopKey ? `${stopKey} to stop` : null]
          .filter((part) => part !== null)
          .join(' · ')}
      </span>
    </div>
  );
}

/**
 * @param editStats Whether the lines about the edit view show: the fly speed,
 *   and the fallback light. Not over the game, nor over the edit image held
 *   while it starts — the counters above them follow whatever is drawn.
 */
function ViewportStats({ editStats }: { editStats: boolean }) {
  const backend = useViewportStore((s) => s.backend);
  const fps = useViewportStore((s) => s.fps);
  const drawCalls = useViewportStore((s) => s.drawCalls);
  const triangles = useViewportStore((s) => s.triangles);
  const flySpeed = useViewportStore((s) => s.flySpeed);
  const fallbackLighting = useViewportStore((s) => s.fallbackLighting);

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
      {editStats && (
        <div className="flex justify-between gap-4">
          <span>Fly</span>
          <span className="text-ink">{flySpeed.toFixed(1)} m/s</span>
        </div>
      )}
      {/* Only while it is on, and last, so it reads as a note about this scene
          rather than as one more counter — and so the numbers above it do not
          move when it appears. What it says is that this view is lit by
          something Play and a build do not have, which over the game is not
          true of anything on screen. */}
      {editStats && fallbackLighting && (
        <div className="flex justify-between gap-4">
          <span>Lighting</span>
          <span className="text-warn">Editor default</span>
        </div>
      )}
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
        {...tooltip('Back to the scene — every prefab is saved on the way out')}
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
