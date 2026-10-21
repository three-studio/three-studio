import { ChevronDown, MonitorPlay, Pause, Play, SkipForward, Square } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { commandById } from '../commands/registry';
import { useEditorStore } from '../state/editorStore';
import { MenuTrigger } from '../ui/Menu';
import { ToolButton } from '../ui/ToolButton';
import { DeviceButton } from './DeviceButton';
import { buildLayoutMenu } from './layoutMenu';

interface ToolbarProps {
  onResetLayout: () => void;
  /** Rendered on the left: the menus. */
  menuSlot?: ReactNode;
  /** Rendered on the right; the viewport fills it in once the renderer exists (M2). */
  statusSlot?: ReactNode;
}

/**
 * The row under the title bar: the menus on the left, the transport in the
 * middle, the layouts on the right.
 *
 * It does not drag the window. It used to, and a press on it went to the
 * system rather than to the page, so a menu left open above it stayed open.
 * Only the title bar drags now.
 */
export function Toolbar({ onResetLayout, menuSlot, statusSlot }: ToolbarProps) {
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  // Saved layouts live in localStorage, not in React state, so the menu is
  // rebuilt on demand after a save or a delete.
  const [, setLayoutVersion] = useState(0);

  const playState = useEditorStore((s) => s.playState);
  const togglePause = useEditorStore((s) => s.togglePause);
  const requestStep = useEditorStore((s) => s.requestStep);

  const isStopped = playState === 'stopped';
  const transport = commandById(isStopped ? 'play' : 'stop');
  const fullScreen = commandById('playFullScreen');

  return (
    <div className="relative flex shrink-0 items-center gap-0.5 bg-surface-0 px-2">
      {menuSlot}

      {/* Transport sits dead centre regardless of how wide the flanking groups get. */}
      <div className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 items-center gap-0.5">
        <div className="pointer-events-auto relative flex items-center gap-0.5">
          {/* One button, and it still picks its own icon — an icon is not
              something the registry carries. What it no longer decides is the
              word and the gesture: `transport.label()` and `transport.run()`
              are the command's, and a palette says the same word. */}
          <ToolButton
            icon={isStopped ? Play : Square}
            label={transport.label()}
            active={!isStopped}
            activeClassName="bg-play/15 text-play"
            onClick={() => transport.run()}
          />
          {/*
            Three slots, filled differently stopped and running, and always
            three wide. Stop has to land exactly where Play was: the pointer is
            still there, and the next click is often the one that stops.
            Centring two buttons stopped and three running would have moved it
            15 px, and the Device button with it. Pause and Step only exist
            while something runs; stopped, the third slot is kept empty.
          */}
          {isStopped ? (
            <>
              <ToolButton icon={MonitorPlay} label={fullScreen.label()} onClick={() => fullScreen.run()} />
              <span aria-hidden className="h-7 w-7" />
            </>
          ) : (
            <>
              <ToolButton
                icon={Pause}
                label="Pause"
                active={playState === 'paused'}
                onClick={togglePause}
              />
              <ToolButton
                icon={SkipForward}
                label="Step one frame"
                disabled={playState !== 'paused'}
                onClick={requestStep}
              />
            </>
          )}
          {/* Off the transport's right edge rather than inside it, so the
              transport stays dead centre. */}
          <DeviceButton className="absolute left-full top-0 ml-3" />
        </div>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        {statusSlot}
        <MenuTrigger
          open={layoutMenuOpen}
          onToggle={() => setLayoutMenuOpen((open) => !open)}
          onHover={() => undefined}
          onClose={() => setLayoutMenuOpen(false)}
          align="right"
          className="flex h-7 items-center gap-1 rounded-sm px-2 text-2xs hover:bg-surface-3"
          items={buildLayoutMenu({
            resetToDefault: onResetLayout,
            onChanged: () => setLayoutVersion((version) => version + 1),
          })}
        >
          <span className="flex items-center gap-1">
            Layout
            <ChevronDown size={12} strokeWidth={2} />
          </span>
        </MenuTrigger>
      </div>
    </div>
  );
}
