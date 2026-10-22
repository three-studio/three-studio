import { findScene } from '@three-studio/core';
import { ChartNoAxesColumn, Pause, Play } from 'lucide-react';
import { useEditorStore } from '../state/editorStore';
import { useProjectStore } from '../state/projectStore';
import { useViewportStore } from '../state/viewportStore';
import { ToolButton } from '../ui/ToolButton';
import { tooltip } from '../ui/Tooltip';
import { ViewHeader } from './PanelShell';

/**
 * The Viewport's header from the press of Play to Stop, in place of the edit
 * tools: what the game is doing, which scene it runs, and Stats.
 *
 * No word for the game's state: the glyph follows it, and the stage already
 * says the rest — its pill says Starting…, its badge Paused.
 *
 * No ⇧Esc reminder either. The capture hint over the game says the next key
 * that is true: ⇧Esc where it stops, and Esc first while the mouse is captured
 * in the panel, where the browser takes every Escape to free it. A reminder here
 * would have to change its words with the hint's or be wrong in one of its
 * states, and full screen, where the bar is not, the hint is alone on screen.
 *
 * Nothing in it takes the focus: the game hears keys only while its canvas
 * holds it, and a press on the bar must leave the keyboard with the game. The
 * glyph and the name are not controls, and Stats leaves the focus where it was.
 */
export function PlayBar() {
  const showStats = useEditorStore((s) => s.showStats);
  const toggleStats = useEditorStore((s) => s.toggleStats);
  const sceneName = useRunningSceneName();

  return (
    <ViewHeader data-play-bar>
      {/* In a tool button's box, so the glyph sits where the first edit tool was. */}
      <span className="flex h-7 w-7 shrink-0 items-center justify-center">
        <PlayGlyph />
      </span>
      {sceneName !== null && (
        <span
          data-running-scene
          className="min-w-0 truncate text-2xs text-ink"
          {...tooltip(sceneName, { hint: 'The scene the game is running' })}
        >
          {sceneName}
        </span>
      )}
      {/* Stats where the edit tools have it, the last of the right-hand group,
          in the same strip: the swap at the press and at Stop leaves it under
          the pointer, as the transport puts Stop where Play was. */}
      <div className="ml-auto flex items-center gap-0.5">
        <ToolButton icon={ChartNoAxesColumn} label="Stats" active={showStats} takesNoFocus onClick={toggleStats} />
      </div>
    </ViewHeader>
  );
}

/**
 * The game's state as a glyph: ▶ in the play green while it starts or runs,
 * ❚❚ in the pause amber while paused.
 *
 * Read from the play state, so that it says Pause from the moment Pause is
 * pressed — before the game's first frame too.
 */
function PlayGlyph() {
  const paused = useEditorStore((s) => s.playState === 'paused');
  const Glyph = paused ? Pause : Play;
  return <Glyph size={12} aria-hidden className={`shrink-0 fill-current ${paused ? 'text-pause' : 'text-play'}`} />;
}

/**
 * The running scene's name, looked up by its id in the scene list: a scene
 * renamed in another window during Play is renamed here too. Nothing for an id
 * the list lacks.
 *
 * A selector that returns the string, so the bar renders when the game changes
 * scene or the scene is renamed, and at no other change of the list.
 */
function useRunningSceneName(): string | null {
  const id = useViewportStore((s) => s.runningScene);
  return useProjectStore((s) => (id === null ? null : (findScene(s.scenes, id)?.name ?? null)));
}
