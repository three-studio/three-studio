import { Gamepad2, MousePointerClick, TriangleAlert } from 'lucide-react';
import type { IDockviewPanelProps } from 'dockview-react';
import { useEffect, useRef, useState } from 'react';
import { commandById } from '../commands/registry';
import { shortcutHint } from '../shell/shortcutBindings';
import { useEditorStore } from '../state/editorStore';
import { useViewportStore } from '../state/viewportStore';
import { acquireViewport, peekViewport } from '../viewport/viewportHost';

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
  const rootRef = useRef<HTMLDivElement>(null);
  const playState = useEditorStore((s) => s.playState);
  const fullScreen = useEditorStore((s) => s.fullScreen);
  const warnings = useViewportStore((s) => s.playWarnings);
  const isRunning = playState !== 'stopped';
  // Whether this panel holds the screen right now, as the document reports it.
  // `fullScreen` is what was asked for; this is what happened.
  const [holdingScreen, setHoldingScreen] = useState(false);
  const [hintShown, setHintShown] = useState(true);

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

  /*
   * Play Full Screen: this panel takes the whole screen, and leaving the screen
   * ends the test. Unreal's way, which is Esc there and Shift+Esc here: the
   * stop is a binding (`shortcutBindings`), and plain Esc stays the game's.
   *
   * Plain Esc would otherwise be Chromium's: it leaves full screen before the
   * page hears it. The keyboard lock hands it to the page instead, and holding
   * it for about two seconds still gets out — Chromium's own way out of a
   * lock, which lands in `onChange` like any other exit and stops the game.
   *
   * The request is made here, after the click that ran Play Full Screen has
   * brought this panel forward. Chromium accepts a full-screen request for a
   * few seconds after a click, which is what lets it come from an effect.
   */
  useEffect(() => {
    const root = rootRef.current;
    if (!isRunning || !fullScreen || root === null) return;

    const onChange = () => {
      const holding = document.fullscreenElement === root;
      setHoldingScreen(holding);
      if (!holding && useEditorStore.getState().playState !== 'stopped') commandById('stop').run();
    };
    document.addEventListener('fullscreenchange', onChange);

    root
      .requestFullscreen()
      .then(() => keyboardLock()?.lock(['Escape']))
      .catch((cause: unknown) => {
        // Refused: the game goes on in its panel, where it still plays.
        console.error('[play] full screen was refused, so the game stays in its panel:', cause);
      });

    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      keyboardLock()?.unlock();
      // Usually already out: removing the panel's root on Stop ends the full
      // screen by itself. Not when the session ends some other way.
      if (document.fullscreenElement === root) void document.exitFullscreen();
      setHoldingScreen(false);
    };
  }, [isRunning, fullScreen]);

  // Full screen is the game as a player sees it, so the hint goes after a moment.
  useEffect(() => {
    if (!holdingScreen) {
      setHintShown(true);
      return;
    }
    const timer = setTimeout(() => setHintShown(false), FULL_SCREEN_HINT_MS);
    return () => clearTimeout(timer);
  }, [holdingScreen]);

  const stopKey = shortcutHint('stop');

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
    <div ref={rootRef} className="relative h-full w-full overflow-hidden bg-surface-0">
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

      <div
        className={`pointer-events-none absolute inset-x-0 bottom-2 flex justify-center transition-opacity duration-700 ${
          hintShown ? 'opacity-100' : 'opacity-0'
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
    </div>
  );
}
