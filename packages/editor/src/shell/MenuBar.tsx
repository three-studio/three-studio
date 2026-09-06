import { useMemo, useState } from 'react';
import {
  commandById,
  contextForScene,
  type CommandId,
  type EditorContext,
} from '../commands/registry';
import { sceneList } from '../commands/sceneFiles';
import { isMac, modKey, shiftKey } from '../platform';
import { selectDirty, useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import { expandedScene } from '../state/expansion';
import { Selection } from '../state/selection';
import { useProjectStore } from '../state/projectStore';
import { MenuTrigger, type MenuEntry, type MenuItem } from '../ui/Menu';
import { buildAddMenu } from './addMenu';
import { PackageDialog } from './PackageDialog';
import { openPanelIds, togglePanel } from './dockApi';
import { ProjectSettingsDialog } from './ProjectSettingsDialog';
import { buildLayoutMenu } from './layoutMenu';
import { PANEL_DEFS } from './panelDefs';

interface MenuBarProps {
  /** Scene name shown on the right of the bar, like Unity's title strip. */
  title: string;
  onResetLayout: () => void;
}

/**
 * The window's native menu is hidden (`titleBarStyle: 'hiddenInset'`), so this
 * bar is both the application menu and the window's drag handle.
 *
 * File entries stay disabled until projects land in M5.
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

  const hasSelection = selection.length > 0;
  const current = Selection.of(selection, expandedScene().scene);

  /**
   * A menu entry from a command.
   *
   * The context is built here, once per render, from the selection this bar
   * already subscribes to — so the entries cannot go stale, and reading the
   * registry adds no subscription of its own. Watching the document from here
   * would re-render the bar once per frame of a gizmo drag, which phase 7
   * removed.
   */
  const entryFor = (id: CommandId, shortcut?: string, target?: EditorContext): MenuItem => {
    const command = commandById(id);
    const ctx = target ?? { selection: current };
    return {
      label: command.label(ctx),
      shortcut,
      disabled: !command.can(ctx),
      onSelect: () => command.run(ctx),
    };
  };

  // Subscribed to the list rather than to the project: the two used to be one
  // object, and the list is now replaced on its own whenever a scene appears or
  // goes — including when another window is what made it happen.
  const storeScenes = useProjectStore((s) => s.scenes);
  const sceneId = useProjectStore((s) => s.sceneId);
  const scenes = useMemo(() => sceneList(), [storeScenes]);
  const sceneMenu: readonly MenuEntry[] = [
    // One gesture pointed at each scene in turn. The `shadowedBy` rule — two
    // files claiming one id, where opening this one would open the other — is
    // the command's now, and the submenu below reads the same one.
    ...scenes.map((scene) => ({
      ...entryFor('openScene', undefined, contextForScene(scene.id)),
      checked: scene.id === sceneId,
    })),
    null,
    // Four entries that used to write their own guards here, or none at all:
    // Duplicate and Rename had no `disabled` while both gestures open with
    // `if (sceneId === null) return`, and Delete carried the last-scene rule in
    // the menu rather than in the gesture. Each one is now the command's own
    // label and the command's own verdict.
    entryFor('newScene'),
    entryFor('duplicateScene'),
    entryFor('renameScene'),
    entryFor('deleteScene'),
    // Every window holds one scene, so a second scene means a second window.
    // Left out entirely with one scene rather than shown disabled: a disabled
    // row that opens an empty submenu on hover is worse than no row.
    ...(scenes.length > 1
      ? ([
          null,
          {
            label: 'Open in New Window',
            // Filtered on the command rather than on a `.filter` writing the
            // same two conditions in its own words — which is where they were,
            // beside a `disabled` that said only half of them.
            submenu: scenes
              .filter((scene) =>
                commandById('openSceneInNewWindow').can(contextForScene(scene.id)),
              )
              .map((scene) => entryFor('openSceneInNewWindow', undefined, contextForScene(scene.id))),
          },
        ] satisfies readonly MenuEntry[])
      : []),
  ];

  const menus: Record<string, readonly MenuEntry[]> = {
    File: [
      {
        label: 'Open Project…',
        shortcut: `${modKey}O`,
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
      entryFor('newScene'),
      null,
      entryFor('save', `${modKey}S`),
      // Not `${modKey}${shiftKey}S`: that is Save All in every editor that has
      // both, and this project has no Save All to be confused with yet.
      entryFor('saveSceneAs'),
      null,
      { label: 'Package…', onSelect: () => setPackageOpen(true) },
    ],
    Edit: [
      // Every entry below is the command's own label, its own verdict and its
      // own body. Greying an entry and refusing a key are the same line now.
      entryFor('undo', `${modKey}Z`),
      entryFor('redo', `${modKey}${shiftKey}Z`),
      null,
      entryFor('duplicate', `${modKey}D`),
      entryFor('delete', isMac ? '⌫' : 'Del'),
      // Group had no menu entry at all: it existed as Cmd+G and nowhere a user
      // could discover it.
      entryFor('group', `${modKey}G`),
      null,
      // Under Edit, where both Unity and Unreal put it.
      { label: 'Project Settings…', onSelect: () => setSettingsOpen(true) },
    ],
    Add: buildAddMenu(),
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
      {/* The title was a label; it is the scene switcher now. The most
          discoverable place for it, and it adds no seventh panel to a dock
          that already has six. */}
      <nav className="app-no-drag pr-2">
        <MenuTrigger
          open={openMenu === 'Scene'}
          onToggle={() => setOpenMenu((current) => (current === 'Scene' ? null : 'Scene'))}
          onHover={() => setOpenMenu((current) => (current === null ? null : 'Scene'))}
          onClose={close}
          items={sceneMenu}
          align="right"
          className="text-ink-dim hover:text-ink"
        >
          {title}
          {dirty && <span className="ml-1 text-warn">•</span>}
        </MenuTrigger>
      </nav>
    </div>
  );
}
