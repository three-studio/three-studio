import { useMemo, useState } from 'react';
import { isMac } from '../platform';
import { selectDirty, useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import { expandedScene } from '../state/expansion';
import { Selection } from '../state/selection';
import { useProjectStore } from '../state/projectStore';
import { MenuTrigger, type MenuEntry } from '../ui/Menu';
import { buildAddMenu } from './addMenu';
import { commandEntry } from './commandEntry';
import { PackageDialog } from './PackageDialog';
import { openPanelIds, togglePanel } from './dockApi';
import { ProjectSettingsDialog } from './ProjectSettingsDialog';
import { buildLayoutMenu } from './layoutMenu';
import { PANEL_DEFS } from './panelDefs';
import { buildSceneMenu } from './sceneMenu';

interface MenuBarProps {
  /**
   * `Project — Scene`, shown on the right of the bar as text, not as a control.
   *
   * `App` builds it from the project's summary, so the bar re-renders when a
   * project opens. New Scene… and Save Scene As… ask `summary !== null`, and
   * this bar subscribes to no summary of its own.
   */
  title: string;
  onResetLayout: () => void;
}

/**
 * The window's native menu is hidden (`titleBarStyle: 'hiddenInset'`), so this
 * bar is both the application menu and the window's drag handle.
 */
export function MenuBar({ title, onResetLayout }: MenuBarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [packageOpen, setPackageOpen] = useState(false);
  // Dockview owns the panel list and does not publish it to React, so the tick
  // marks are re-read whenever the menu is opened or a panel is toggled.
  const [panelVersion, setPanelVersion] = useState(0);
  const openPanels = useMemo(() => openPanelIds(), [openMenu, panelVersion]);
  const close = () => setOpenMenu(null);

  const selection = useEditorStore((s) => s.selection);
  // Labels and booleans, not the `past`/`future` arrays: those get a new
  // identity on every mutation, so subscribing to them re-rendered this bar once
  // per frame of a gizmo drag. A coalesced drag keeps one label throughout.
  const dirty = useDocumentStore(selectDirty);
  /*
   * Subscribed to but never read here: `saveCommand.can()` reads it, and this
   * bar has to re-render when the answer changes. Deleting it as unused would
   * leave "Save Scene" greyed out for the rest of the session after one save.
   */
  useProjectStore((s) => s.saving);

  /*
   * The context of the Edit entries, built here once per render from the
   * selection this bar already subscribes to — so the entries cannot go stale,
   * and reading the registry adds no subscription of its own. Watching the
   * document from here would re-render the bar once per frame of a gizmo drag,
   * which phase 7 removed.
   */
  const ctx = { selection: Selection.of(selection, expandedScene().scene) };

  // Subscribed to the list rather than to the project: the two used to be one
  // object, and the list is now replaced on its own whenever a scene appears or
  // goes — including when another window is what made it happen.
  const scenes = useProjectStore((s) => s.scenes);
  // Which row of Open Scene ▸ is checked, and what Duplicate, Rename, Delete and
  // Open in New Window ▸ ask before they offer themselves.
  const sceneId = useProjectStore((s) => s.sceneId);
  // The start scene alone rather than the project: saving the settings replaces
  // the project object (`adoptProject`) and nothing in the bar changes then. It
  // moves from this menu, from Project Settings or from another window
  // (`onProjectChanged`); the Scene menu marks it, and Set as Start Scene asks
  // it before it offers itself.
  const startScene = useProjectStore((s) => s.project?.startScene ?? null);

  const menus: Record<string, readonly MenuEntry[]> = {
    File: [
      {
        label: 'Open Project…',
        // No ⌘O beside it: no key is bound to it, and a menu that prints a
        // shortcut promises that the key works.
        //
        // A window belongs to one project, so opening another replaces this
        // window rather than reloading inside it. The main process closes this
        // one — running the unsaved-changes prompt on the way — and opens the
        // next; cancelling at that prompt leaves everything as it was.
        onSelect: () => {
          void window.studio.project.browseForProject().then((picked) => {
            if (picked !== null) void window.studio.project.launch(picked);
          });
        },
      },
      {
        // Closing the window is what closes the project: it runs the same
        // unsaved-changes prompt as the title bar's button, and brings the
        // launcher back.
        label: 'Close Project',
        onSelect: () => window.close(),
      },
      null,
      { label: 'Package…', onSelect: () => setPackageOpen(true) },
    ],
    Edit: [
      // Every entry below is the command's own label, its own verdict and its
      // own body. Greying an entry and refusing a key are the same line now.
      commandEntry('openCommandPalette', ctx),
      null,
      commandEntry('undo', ctx),
      commandEntry('redo', ctx),
      null,
      commandEntry('duplicate', ctx),
      commandEntry('delete', ctx),
      // Group had no menu entry at all: it existed as Cmd+G and nowhere a user
      // could discover it.
      commandEntry('group', ctx),
      null,
      // Under Edit, where both Unity and Unreal put it.
      { label: 'Project Settings…', onSelect: () => setSettingsOpen(true) },
    ],
    Add: buildAddMenu(),
    // Built in render, like the others, so its rows cannot go stale. After Add,
    // the way an object menu follows the insert menu on macOS — Keynote reads
    // File · Edit · Insert · Slide — so Add keeps the place people reach for.
    Scene: buildSceneMenu({ scenes, sceneId, startScene }),
    // Panels are closable, so the Window menu is the way back. Without it a
    // closed Game tab meant Play ran with nothing on screen and no obvious fix.
    Window: [
      ...PANEL_DEFS.map((def) => ({
        label: def.title,
        checked: openPanels.includes(def.id),
        onSelect: () => {
          togglePanel(def.id);
          setPanelVersion((version) => version + 1);
        },
      })),
      null,
      {
        label: 'Layouts',
        // Nested rather than flat: the list grows with every layout the user
        // saves, and it would otherwise bury the panel toggles above it.
        // "Reset Layout" is gone from here — it was a second name for
        // "Layouts ▸ Default", and one action should have one name.
        submenu: buildLayoutMenu({
          resetToDefault: onResetLayout,
          onChanged: () => setPanelVersion((version) => version + 1),
        }),
      },
    ],
  };

  return (
    <div
      // The whole strip drags the window; the buttons opt back out below.
      className="app-drag flex h-9 shrink-0 items-center border-b border-line bg-surface-2 text-2xs"
      style={{ paddingLeft: isMac ? 78 : 8 }}
    >
      <nav className="app-no-drag flex items-center gap-px">
        {Object.entries(menus).map(([label, items]) => (
          <MenuTrigger
            key={label}
            open={openMenu === label}
            onToggle={() => setOpenMenu((current) => (current === label ? null : label))}
            onHover={() => setOpenMenu((current) => (current === null ? null : label))}
            onClose={close}
            items={items}
          >
            {label}
          </MenuTrigger>
        ))}
      </nav>

      {settingsOpen && <ProjectSettingsDialog onClose={() => setSettingsOpen(false)} />}
      {packageOpen && <PackageDialog onClose={() => setPackageOpen(false)} />}

      <div className="flex-1" />
      {/* A label, not a menu: the Scene menu is the one door to the scene
          gestures, and this is the only place where the window says which
          scene it holds, since `titleBarStyle: 'hiddenInset'` hides the native
          title. Plain text inside the strip, so pressing on it drags the window
          like any empty part of the bar. Not `data-selectable`: text that can
          be selected cannot also drag. */}
      <span className="pl-2 pr-4 text-ink-dim">
        {title}
        {dirty && <span className="ml-1 text-warn">•</span>}
      </span>
    </div>
  );
}
