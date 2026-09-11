import { Gamepad2, MousePointerClick, TriangleAlert } from 'lucide-react';
import type { IDockviewPanelProps } from 'dockview-react';
import { useEffect, useRef } from 'react';
import { commandById } from '../commands/registry';
import { useEditorStore } from '../state/editorStore';
import { useViewportStore } from '../state/viewportStore';
import { acquireViewport, peekViewport } from '../viewport/viewportHost';

/**
 * Where the running game is shown.
 *
 * Its own canvas, but not its own renderer: a second `WebGPURenderer` in the
 * same document would destroy this one's output target every frame. The one
 * renderer draws both views and each panel is handed a copy of its own — see
 * `Presentation` — which is what lets this be read next to the Scene view
 * instead of in place of it.
 */
export function GamePanel(props: IDockviewPanelProps) {
  // What the box cannot say: dockview parks an inactive tab at full size, so a
  // hidden panel goes on being drawn unless something tells the viewport. The
  // dock is the only thing that knows, and it publishes it here.
  useEffect(() => {
    const push = (onScreen: boolean) => void acquireViewport().then((v) => v.setGameOnScreen(onScreen));
    push(props.api.isVisible);
    const sub = props.api.onDidVisibilityChange((event) => push(event.isVisible));
    return () => sub.dispose();
  }, [props.api]);

  const hostRef = useRef<HTMLDivElement>(null);
  const playState = useEditorStore((s) => s.playState);
  const warnings = useViewportStore((s) => s.playWarnings);
  const isRunning = playState !== 'stopped';

  useEffect(() => {
    if (!isRunning) return;
    let cancelled = false;

    void acquireViewport().then((viewport) => {
      if (cancelled || !hostRef.current) return;
      viewport.attachGame(hostRef.current);
    });

    return () => {
      cancelled = true;
      // The canvas outlives this component; hand it back rather than leaving it
      // parented to a container React is about to drop.
      peekViewport()?.detachGame();
    };
  }, [isRunning]);

  if (!isRunning) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-surface-1 text-ink-dim">
        <Gamepad2 size={28} strokeWidth={1.25} />
        <p className="text-ink-muted">Not playing</p>
        <button
          type="button"
          onClick={() => commandById('play').run()}
          className="rounded-sm bg-accent px-3 py-1.5 text-2xs font-medium text-white hover:bg-accent/85"
        >
          Play
        </button>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-surface-0">
      <div ref={hostRef} className="absolute inset-0" />

      {playState === 'paused' && (
        <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
          <span className="rounded-sm bg-surface-0/80 px-2 py-1 text-2xs text-warn">Paused</span>
        </div>
      )}

      {/* Set-up problems are placed where the eye lands, not tucked away: every
          one of them fails silently in the simulation. */}
      {warnings.length > 0 && (
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
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
        <span className="flex items-center gap-1.5 rounded-sm bg-surface-0/70 px-2 py-1 text-2xs text-ink-muted">
          <MousePointerClick size={11} />
          Click to capture the mouse · Esc to release
        </span>
      </div>
    </div>
  );
}
