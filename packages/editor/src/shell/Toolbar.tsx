import {
  Axis3d,
  Box,
  ChevronDown,
  Globe,
  ListTree,
  type LucideIcon,
  Magnet,
  Move3d,
  MousePointer2,
  Move,
  Pause,
  Play,
  RotateCw,
  Scale3d,
  SkipForward,
  Square,
  Timer,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { commandById } from '../commands/registry';
import {
  TRANSFORM_SPACES,
  useEditorStore,
  type TransformMode,
  type TransformSpace,
} from '../state/editorStore';
import { useViewportStore } from '../state/viewportStore';
import { MenuTrigger } from '../ui/Menu';
import { ToolButton, ToolSplitToggle, ToolToggle, ToolbarSeparator } from '../ui/ToolButton';
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

/**
 * What each handle space is called, drawn as, and does.
 *
 * "Auto" is the author's word for `parent`, and `parent` is what it computes:
 * the parent's axes, which are the world's at the root because a root entity's
 * parent carries no transform. Blender ships the same orientation and calls it
 * Parent; the hint is here so the button does not have to be believed on
 * faith.
 */
const SPACE_LABELS: Record<TransformSpace, string> = {
  world: 'Global',
  local: 'Local',
  parent: 'Auto',
};

const SPACE_ICONS: Record<TransformSpace, LucideIcon> = {
  world: Globe,
  local: Move3d,
  parent: ListTree,
};

const SPACE_HINTS: Record<TransformSpace, string> = {
  world: 'handles on the world axes',
  local: "handles on the object's own axes",
  parent: "handles on the parent's axes, the world's at the root",
};

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
  const cycleTransformSpace = useEditorStore((s) => s.cycleTransformSpace);
  const setTransformSpace = useEditorStore((s) => s.setTransformSpace);
  const togglePivotMode = useEditorStore((s) => s.togglePivotMode);
  const toggleSnap = useEditorStore((s) => s.toggleSnap);
  const toggleGizmos = useEditorStore((s) => s.toggleGizmos);
  const togglePause = useEditorStore((s) => s.togglePause);
  const requestStep = useEditorStore((s) => s.requestStep);

  const animated = useViewportStore((s) => s.animated);
  const toggleAnimated = useViewportStore((s) => s.toggleAnimated);

  // Scale is oriented to the object whatever the button says, so in that mode
  // the button says the truth rather than the store's value.
  const scaleForcesLocal = transformMode === 'scale';
  const shownSpace: TransformSpace = scaleForcesLocal ? 'local' : transformSpace;

  const isStopped = playState === 'stopped';
  const transport = commandById(isStopped ? 'play' : 'stop');

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
          active={pivotMode === 'center'}
          onClick={togglePivotMode}
        />
        {/*
          Scale has no Global, so the button stops offering one. Three forces
          local space for scale internally, because a non-uniform scale along a
          world axis on a rotated object is a shear and position/rotation/scale
          has nowhere to put shear — `GizmoController` argues it at length and
          `pivotPose` is where it is enforced. A button announcing "Global"
          while the gizmo does the opposite is the interface lying; Unity and
          Unreal grey theirs out for the same reason.
        */}
        <ToolSplitToggle
          label={SPACE_LABELS[shownSpace]}
          hint={SPACE_HINTS[shownSpace]}
          icon={SPACE_ICONS[shownSpace]}
          shortcut="X"
          active={shownSpace !== 'world'}
          disabled={scaleForcesLocal}
          onCycle={cycleTransformSpace}
          items={TRANSFORM_SPACES.map((space) => ({
            label: SPACE_LABELS[space],
            icon: SPACE_ICONS[space],
            checked: space === shownSpace,
            onSelect: () => setTransformSpace(space),
          }))}
        />
        <ToolButton icon={Magnet} label="Snap to grid" active={snapEnabled} onClick={toggleSnap} />
        <ToolButton
          icon={Axis3d}
          label="Gizmos"
          active={showGizmos}
          onClick={toggleGizmos}
        />
        {/*
          Unreal's Realtime, Unity's Always Refresh. Off by default so a moving
          surface is never mistaken for a running game — see `viewport/timescale`.
        */}
        <ToolButton
          icon={Timer}
          label="Animate in viewport"
          active={animated}
          onClick={toggleAnimated}
        />
      </div>

      {/* Transport sits dead centre regardless of how wide the flanking groups get. */}
      <div className="app-no-drag pointer-events-none absolute left-1/2 flex -translate-x-1/2 items-center gap-0.5">
        <div className="pointer-events-auto flex items-center gap-0.5">
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
