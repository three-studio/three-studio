import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type DockviewTheme,
  type IDockviewPanelProps,
} from 'dockview-react';
import { useCallback, useEffect, type FunctionComponent } from 'react';
import {
  ConsolePanel,
  HierarchyPanel,
  InspectorPanel,
  ProjectPanel,
  ViewportPanel,
} from '../panels';
import { setDockApi } from './dockApi';
import { watchPanelFocus } from './panelFocus';
import { loadLayout, saveLayout } from './layoutStorage';
import { watchViewportClose } from './viewportClose';

/**
 * Panel id -> component. Adding a panel to the editor means adding one entry
 * here, one row in `PANEL_DEFS` and one `api.addPanel` call in
 * `applyDefaultLayout`.
 *
 * Ids are persisted inside every saved layout, the working one and the
 * templates, and nothing migrates them. A layout naming an id `PANEL_DEFS`
 * lacks is refused before dockview sees it (`isUsableLayout`), and the default
 * takes its place — so renaming or removing an id resets every stored layout.
 * Not left to `fromJSON` to refuse: it throws only after mounting the panels
 * before the unknown one, and its revert leaves them mounted.
 */
const PANEL_COMPONENTS: Record<string, FunctionComponent<IDockviewPanelProps>> = {
  hierarchy: HierarchyPanel,
  viewport: ViewportPanel,
  inspector: InspectorPanel,
  project: ProjectPanel,
  console: ConsolePanel,
};

/** The gutter between two panels, and between the panels and the rest of the window, in pixels. */
const DOCK_GAP = 4;

/**
 * dockview's dark theme, with the panels set apart by gutters rather than lines.
 *
 * The class is the one the dock already carried, so the gap is all that is new.
 * The theme also goes on dockview's shell, where the floating groups live. With
 * no theme passed, the shell wore dockview's default, `abyss`.
 */
const DOCK_THEME: DockviewTheme = {
  name: 'studio',
  className: 'dockview-theme-dark',
  colorScheme: 'dark',
  gap: DOCK_GAP,
};

/**
 * Unity's default arrangement: hierarchy on the left, the Viewport in the
 * middle where Unity has its Scene and Game tabs, inspector down the full right
 * edge, Project/Console across the bottom of the centre column.
 *
 * Insertion order matters — the inspector is added before the bottom dock so it
 * spans the full window height rather than stopping above it.
 */
function applyDefaultLayout(api: DockviewApi): void {
  api.addPanel({ id: 'viewport', component: 'viewport', title: 'Viewport' });

  api.addPanel({
    id: 'hierarchy',
    component: 'hierarchy',
    title: 'Hierarchy',
    initialWidth: 240,
    position: { referencePanel: 'viewport', direction: 'left' },
  });

  api.addPanel({
    id: 'inspector',
    component: 'inspector',
    title: 'Inspector',
    initialWidth: 320,
    position: { referencePanel: 'viewport', direction: 'right' },
  });

  api.addPanel({
    id: 'project',
    component: 'project',
    title: 'Project',
    initialHeight: 220,
    position: { referencePanel: 'viewport', direction: 'below' },
  });

  api.addPanel({
    id: 'console',
    component: 'console',
    title: 'Console',
    inactive: true,
    position: { referencePanel: 'project', direction: 'within' },
  });

  api.getPanel('viewport')?.api.setActive();
}

interface DockLayoutProps {
  /**
   * Incremented by the caller to reset the layout. Used as the component key,
   * which remounts dockview entirely.
   *
   * Rebuilding in place with `api.clear()` looked cleaner but left every panel
   * blank: with `renderer: 'always'` dockview parks panel DOM in an overlay
   * container, and clearing detaches it from the groups the re-added panels
   * belong to. A remount has no such halfway state.
   */
  resetToken: number;
}

export function DockLayout({ resetToken }: DockLayoutProps) {
  return <DockviewHost key={resetToken} />;
}

function DockviewHost() {
  // What the arrangement does about state: bring the Viewport forward when the
  // game starts, the Project panel when an asset is revealed, the Inspector
  // when Scene Settings… is asked for. It used to be `commands/` calling
  // `showPanel` itself — see `panelFocus.ts`.
  useEffect(() => watchPanelFocus(), []);

  const onReady = useCallback((event: DockviewReadyEvent) => {
    setDockApi(event.api);
    // Closing the Viewport during Play stops the game. Once per dock: a remount
    // disposes this one, listeners and all, and the next is watched by its own
    // call.
    watchViewportClose(event.api);

    // Subscribed before the layout is built so the initial arrangement is
    // persisted too, and debounced because dragging a sash emits a change per
    // frame.
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    event.api.onDidLayoutChange(() => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => saveLayout(event.api.toJSON()), 250);
    });

    const stored = loadLayout();
    if (stored) {
      try {
        event.api.fromJSON(stored);
        return;
      } catch {
        // Anything else dockview refuses; start over rather than leaving the
        // user with an empty window. A layout saved against an older panel set
        // never gets here: `loadLayout` does not hand it back.
        event.api.clear();
      }
    }
    applyDefaultLayout(event.api);
  }, []);

  return (
    // The same gutter around the outside, so the bars above and below are set
    // apart from the panels the way the panels are from each other.
    <div className="h-full w-full" style={{ padding: DOCK_GAP }}>
      <DockviewReact
        components={PANEL_COMPONENTS}
        onReady={onReady}
        className="dockview-theme-dark studio-dock h-full w-full"
        theme={DOCK_THEME}
        // The separator lines go; the gap is the separation now.
        hideBorders
        // Panels own GPU resources and DOM that is expensive to rebuild, so hidden
        // tabs keep their DOM instead of being unmounted.
        defaultRenderer="always"
        disableFloatingGroups={false}
      />
    </div>
  );
}
