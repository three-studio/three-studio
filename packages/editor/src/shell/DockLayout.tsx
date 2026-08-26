import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from 'dockview-react';
import { useCallback, type FunctionComponent } from 'react';
import {
  ConsolePanel,
  GamePanel,
  HierarchyPanel,
  InspectorPanel,
  ProjectPanel,
  ViewportPanel,
} from '../panels';
import { setDockApi } from './dockApi';
import { loadLayout, saveLayout } from './layoutStorage';

/**
 * Panel id -> component. Adding a panel to the editor means adding one entry
 * here and one `api.addPanel` call in `applyDefaultLayout`.
 *
 * Ids are persisted inside saved layouts, so renaming one requires bumping
 * `LAYOUT_VERSION` in layoutStorage.
 */
const PANEL_COMPONENTS: Record<string, FunctionComponent<IDockviewPanelProps>> = {
  hierarchy: HierarchyPanel,
  viewport: ViewportPanel,
  game: GamePanel,
  inspector: InspectorPanel,
  project: ProjectPanel,
  console: ConsolePanel,
};

/**
 * Unity's default arrangement: hierarchy on the left, Scene/Game tabs in the
 * middle, inspector down the full right edge, Project/Console across the bottom
 * of the centre column.
 *
 * Insertion order matters — the inspector is added before the bottom dock so it
 * spans the full window height rather than stopping above it.
 */
function applyDefaultLayout(api: DockviewApi): void {
  api.addPanel({ id: 'viewport', component: 'viewport', title: 'Scene' });

  api.addPanel({
    id: 'game',
    component: 'game',
    title: 'Game',
    inactive: true,
    position: { referencePanel: 'viewport', direction: 'within' },
  });

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
  const onReady = useCallback((event: DockviewReadyEvent) => {
    setDockApi(event.api);

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
        // A layout saved against an older panel set is unusable; start over
        // rather than leaving the user with an empty window.
        event.api.clear();
      }
    }
    applyDefaultLayout(event.api);
  }, []);

  return (
    <DockviewReact
      components={PANEL_COMPONENTS}
      onReady={onReady}
      className="dockview-theme-dark studio-dock h-full w-full"
      // Panels own GPU resources and DOM that is expensive to rebuild, so hidden
      // tabs keep their DOM instead of being unmounted.
      defaultRenderer="always"
      disableFloatingGroups={false}
    />
  );
}
