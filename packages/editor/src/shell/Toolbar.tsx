import {
  Axis3d,
  Box,
  ChevronDown,
  Globe,
  type LucideIcon,
  Magnet,
  MousePointer2,
  Move,
  Pause,
  Play,
  RotateCw,
  Scale3d,
  SkipForward,
  Square,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { startPlay, stopPlay } from '../commands/playCommands';
import { useEditorStore, type TransformMode } from '../state/editorStore';
import { MenuTrigger } from '../ui/Menu';
import { ToolButton, ToolToggle, ToolbarSeparator } from '../ui/ToolButton';
import { buildLayoutMenu } from './layoutMenu';

interface TransformTool {
  mode: TransformMode;
  icon: LucideIcon;
  label: string;
  key: string;
}

const TRANSFORM_TOOLS: readonly TransformTool[] = [
  { mode: 'select', icon: MousePointer2, label: 'Select', key: 'Q' },
  { mode: 'translate', icon: Move, label: 'Move', key: 'W' },
  { mode: 'rotate', icon: RotateCw, label: 'Rotate', key: 'E' },
  { mode: 'scale', icon: Scale3d, label: 'Scale', key: 'R' },
];

interface ToolbarProps {
  onResetLayout: () => void;
  /** Rendered on the right; the viewport fills it in once the renderer exists (M2). */
  statusSlot?: ReactNode;
}

export function Toolbar({ onResetLayout, statusSlot }: ToolbarProps) {
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  // Saved layouts live in localStorage, not in React state, so the menu is
  // rebuilt on demand after a save or a delete.
  const [, setLayoutVersion] = useState(0);

  const transformMode = useEditorStore((s) => s.transformMode);
  const transformSpace = useEditorStore((s) => s.transformSpace);
  const pivotMode = useEditorStore((s) => s.pivotMode);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const showGizmos = useEditorStore((s) => s.showGizmos);
  const playState = useEditorStore((s) => s.playState);

  const setTransformMode = useEditorStore((s) => s.setTransformMode);
  const toggleTransformSpace = useEditorStore((s) => s.toggleTransformSpace);
  const togglePivotMode = useEditorStore((s) => s.togglePivotMode);
  const toggleSnap = useEditorStore((s) => s.toggleSnap);
  const toggleGizmos = useEditorStore((s) => s.toggleGizmos);
  const togglePause = useEditorStore((s) => s.togglePause);
  const requestStep = useEditorStore((s) => s.requestStep);

  const isStopped = playState === 'stopped';

  return (
    <div className="app-drag relative flex h-10 shrink-0 items-center gap-0.5 border-b border-line bg-surface-2 px-2">
      <div className="app-no-drag flex items-center gap-0.5">
        {TRANSFORM_TOOLS.map((tool) => (
          <ToolButton
            key={tool.mode}
            icon={tool.icon}
            label={tool.label}
            shortcut={tool.key}
            active={transformMode === tool.mode}
            onClick={() => setTransformMode(tool.mode)}
          />
        ))}

        <ToolbarSeparator />

        <ToolToggle
          label={pivotMode === 'center' ? 'Center' : 'Pivot'}
          icon={Box}
          onClick={togglePivotMode}
        />
        <ToolToggle
          label={transformSpace === 'world' ? 'Global' : 'Local'}
          icon={Globe}
          onClick={toggleTransformSpace}
        />
        <ToolButton icon={Magnet} label="Snap to grid" active={snapEnabled} onClick={toggleSnap} />
        <ToolButton
          icon={Axis3d}
          label="Gizmos"
          active={showGizmos}
          onClick={toggleGizmos}
        />
      </div>

      {/* Transport sits dead centre regardless of how wide the flanking groups get. */}
      <div className="app-no-drag pointer-events-none absolute left-1/2 flex -translate-x-1/2 items-center gap-0.5">
        <div className="pointer-events-auto flex items-center gap-0.5">
          <ToolButton
            icon={isStopped ? Play : Square}
            label={isStopped ? 'Play' : 'Stop'}
            active={!isStopped}
            activeClassName="bg-play/15 text-play"
            onClick={isStopped ? startPlay : stopPlay}
          />
          <ToolButton
            icon={Pause}
            label="Pause"
            active={playState === 'paused'}
            disabled={isStopped}
            onClick={togglePause}
          />
          <ToolButton
            icon={SkipForward}
            label="Step one frame"
            disabled={playState !== 'paused'}
            onClick={requestStep}
          />
        </div>
      </div>

      <div className="flex-1" />

      <div className="app-no-drag flex items-center gap-2">
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
