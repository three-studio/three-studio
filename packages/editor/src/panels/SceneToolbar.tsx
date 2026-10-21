import {
  Axis3d,
  Box,
  ChartNoAxesColumn,
  Globe,
  Grid3x3,
  ListTree,
  type LucideIcon,
  Magnet,
  Move3d,
  MousePointer2,
  Move,
  RotateCw,
  Scale3d,
  Timer,
} from 'lucide-react';
import {
  TRANSFORM_SPACES,
  useEditorStore,
  type TransformMode,
  type TransformSpace,
} from '../state/editorStore';
import { useViewportStore } from '../state/viewportStore';
import { ToolButton, ToolSplitToggle, ToolToggle, ToolbarSeparator } from '../ui/ToolButton';

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

/**
 * The Scene view's own header: what the handles do on the left, what the view
 * shows on the right.
 *
 * In the panel rather than in the window's toolbar, because every control here
 * is about this view and no other — Blender heads each 3D view the same way. A
 * strip of the panel's own rather than buttons laid over the canvas: the canvas
 * starts below it, so no part of the scene is ever under a button.
 */
export function SceneToolbar() {
  const transformMode = useEditorStore((s) => s.transformMode);
  const transformSpace = useEditorStore((s) => s.transformSpace);
  const pivotMode = useEditorStore((s) => s.pivotMode);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const showGizmos = useEditorStore((s) => s.showGizmos);
  const showGrid = useEditorStore((s) => s.showGrid);
  const showStats = useEditorStore((s) => s.showStats);

  const setTransformMode = useEditorStore((s) => s.setTransformMode);
  const cycleTransformSpace = useEditorStore((s) => s.cycleTransformSpace);
  const setTransformSpace = useEditorStore((s) => s.setTransformSpace);
  const togglePivotMode = useEditorStore((s) => s.togglePivotMode);
  const toggleSnap = useEditorStore((s) => s.toggleSnap);
  const toggleGizmos = useEditorStore((s) => s.toggleGizmos);
  const toggleGrid = useEditorStore((s) => s.toggleGrid);
  const toggleStats = useEditorStore((s) => s.toggleStats);

  const animated = useViewportStore((s) => s.animated);
  const toggleAnimated = useViewportStore((s) => s.toggleAnimated);

  // Scale is oriented to the object whatever the button says, so in that mode
  // the button says the truth rather than the store's value.
  const scaleForcesLocal = transformMode === 'scale';
  const shownSpace: TransformSpace = scaleForcesLocal ? 'local' : transformSpace;

  return (
    // `overflow-clip` rather than `hidden`, for the reason `#root` gives in
    // `styles.css`: a panel too narrow for the strip cuts its last buttons off
    // instead of becoming a box that focusing a button can scroll.
    <div className="flex h-8 shrink-0 items-center gap-0.5 overflow-clip bg-surface-1 px-1">
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

      <div className="ml-auto flex items-center gap-0.5">
        <ToolButton icon={Axis3d} label="Gizmos" active={showGizmos} onClick={toggleGizmos} />
        <ToolButton icon={Grid3x3} label="Grid" active={showGrid} onClick={toggleGrid} />
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
        <ToolButton icon={ChartNoAxesColumn} label="Stats" active={showStats} onClick={toggleStats} />
      </div>
    </div>
  );
}
