import {
  capabilitiesOf,
  componentDefinition,
  findComponent,
  hasComponent,
  splitInstancedId,
  type ComponentIcon,
  type ComponentType,
  type EntityDoc,
  type ExpandedScene,
  type SceneDoc,
} from '@three-studio/core';
import {
  Box,
  Boxes,
  Camera,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  FileCode,
  Lightbulb,
  Move,
  Search,
  Shapes,
  Trash2,
  Volume2,
  Weight,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { commandById, contextFor, type CommandId } from '../commands/registry';
import {
  renameEntity,
  reparentSelection,
  setEntityVisible,
} from '../commands/sceneCommands';
import { hasModifier, isMac, modKey } from '../platform';
import {
  applyInstanceOverrides,
  createPrefabFromEntity,
  createPrefabVariant,
  instanceInfo,
  overridesOf,
  selectPrefabInstances,
  revertEntityOverride,
  revertInstanceOverrides,
  unpackPrefabInstance,
} from '../commands/prefabCommands';
import { unpackModel } from '../commands/modelCommands';
import { expandedScene } from '../state/expansion';
import { buildRows, type Row } from './hierarchyRows';
import { Selection } from '../state/selection';
import { useAssetStore } from '../state/assetStore';
import { usePrefabModeStore } from '../state/prefabModeStore';
import { useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import { ContextMenu, type MenuEntry } from '../ui/Menu';
import { PanelToolbar } from './PanelShell';

const DRAG_MIME = 'application/x-studio-entity';
const INDENT_PX = 12;
/** Matches the `h-6` on a row; windowing needs a height it can trust. */
const ROW_HEIGHT = 24;
const OVERSCAN_ROWS = 8;

/**
 * The lucide component for each icon name a component definition can carry.
 *
 * The **name** comes from `@three-studio/core`, which cannot import lucide — it cannot
 * import anything. So the type says which icon it wants and this table is the one
 * place that turns that into something React can draw.
 */
const COMPONENT_ICONS: Record<ComponentIcon, LucideIcon> = {
  box: Box,
  boxes: Boxes,
  camera: Camera,
  'file-code': FileCode,
  lightbulb: Lightbulb,
  move: Move,
  shapes: Shapes,
  volume: Volume2,
  weight: Weight,
};

/**
 * Which component decides a row's icon when an entity has several.
 *
 * Ordering is a decision about this tree, not about the types, so it stays here:
 * a prefab instance is what the row *is*, whatever else got added to it. Types
 * absent from the list fall through to the generic box, which is what a mesh, a
 * model or a bare entity has always drawn.
 */
const ICON_PRIORITY: readonly ComponentType[] = [
  'prefabInstance',
  'light',
  'camera',
  // After the three above and before the fall-through: an entity that is a
  // sound and nothing else is very common — a dropped clip makes one — and a
  // row of identical boxes is a hierarchy nobody can scan.
  'audioSource',
  'audioListener',
];

function entityIcon(scene: SceneDoc, entityId: string): LucideIcon {
  for (const type of ICON_PRIORITY) {
    if (!hasComponent(scene, entityId, type)) continue;
    const icon = componentDefinition(type)?.icon;
    if (icon) return COMPONENT_ICONS[icon];
  }
  return Box;
}

export function HierarchyPanel() {
  /*
   * Structure, not the scene.
   *
   * Subscribing to `scene` re-ran this whole panel on every mutation — so
   * dragging one cube rebuilt two thousand rows sixty times a second to produce
   * an identical list. `structureRevision` moves only when something that is
   * *listed* changes: an entity added, removed, renamed, hidden, reparented.
   */
  const structureRevision = useDocumentStore((s) => s.structureRevision);
  // Subscribed to, not just read: editing a prefab asset changes what this tree
  // shows without changing a single entity in the document.
  const prefabs = useAssetStore((s) => s.prefabs);
  const selection = useEditorStore((s) => s.selection);
  const setSelection = useEditorStore((s) => s.setSelection);
  // One value for the whole render, memoised on `(ids, scene)`: `has()` is asked
  // once per row, and rebuilding a Set per row is the cost this removes.
  const expanded = expandedScene().scene;
  const selected = Selection.of(selection, expanded);

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  /** The row a between-rows drop would land above, for the insertion line. */
  const [dropBetween, setDropBetween] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entityId: string } | null>(null);

  const rows = useMemo(
    () => buildRows(expandedScene(), collapsed, filter),
    [structureRevision, prefabs, collapsed, filter],
  );

  /*
   * Only the rows that fit are rendered.
   *
   * A scene with two thousand prefab instances is four thousand rows, and
   * React re-rendered every one of them on every edit: measured at 422ms per
   * gizmo nudge against 18ms with this panel closed. Nothing else in the edit
   * path came close — the mutation was 0.5ms and the binder 1.2ms.
   */
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    setHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);

  // A margin either side, so a fast scroll does not show a blank strip before
  // React catches up.
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS);
  const last = Math.min(
    rows.length,
    Math.ceil((scrollTop + Math.max(height, ROW_HEIGHT)) / ROW_HEIGHT) + OVERSCAN_ROWS,
  );
  const visibleRows = rows.slice(first, last);
  const before = first;
  const after = rows.length - last;

  const toggleCollapsed = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onRowClick = (event: MouseEvent, id: string) => {
    if (event.shiftKey) {
      // A range, from whatever was picked last. The rows are a flat array since
      // phase 7, so this is two indices — the reason that extraction paid twice.
      const from = rows.findIndex((row) => row.entity.id === (selected.primary ?? id));
      const to = rows.findIndex((row) => row.entity.id === id);
      if (from !== -1 && to !== -1) {
        const [start, end] = from <= to ? [from, to] : [to, from];
        // The anchor stays last, so it remains the primary and the gizmo does not
        // jump to the other end of the range.
        const span = rows.slice(start, end + 1).map((row) => row.entity.id);
        setSelection([...span.filter((other) => other !== id), id]);
        return;
      }
    }
    if (hasModifier(event)) {
      setSelection(
        selection.includes(id) ? selection.filter((other) => other !== id) : [...selection, id],
      );
    } else {
      setSelection([id]);
    }
  };

  /** Row actions only — creating objects stays in the Add menu of the menu bar. */
  const openMenu = (event: MouseEvent, entityId: string) => {
    event.preventDefault();
    event.stopPropagation();
    // Right-clicking outside the selection acts on what was clicked, not on a
    // selection the user may have forgotten about.
    if (!selected.has(entityId)) setSelection([entityId]);
    setMenu({ x: event.clientX, y: event.clientY, entityId });
  };

  const menuItems = (entityId: string): MenuEntry[] => {
    const targets = selected.has(entityId) ? selected : Selection.of([entityId], expandedScene().scene);
    const many = targets.isMultiple;
    const instance = splitInstancedId(entityId);
    // Read when the menu opens, not subscribed to: the panel no longer re-renders
    // on every mutation, and this is the current value either way.
    const document = useDocumentStore.getState().scene;
    const isPrefabHost =
      document.entities[entityId] !== undefined &&
      hasComponent(document, entityId, 'prefabInstance');
    const prefabInfo = isPrefabHost ? instanceInfo(entityId) : null;
    // Only on the entity that still draws a whole file: a piece of an unpacked
    // model carries a `model` too, and there is nothing left in it to take
    // apart.
    const unpackable =
      !many &&
      capabilitiesOf(document, entityId).has('unpackModel') &&
      findComponent(document, entityId, 'model')?.nodePath === '';

    // A produced entity belongs to a prefab, not to the scene. Renaming it is an
    // override and works; adding or removing one is a change to the asset, and
    // an item that silently does nothing is worse than one that is greyed out.
    if (instance) {
      const owner = instanceInfo(instance.owner);
      return [
        { label: 'Rename', onSelect: () => setRenaming(entityId) },
        { label: 'Revert to Prefab', onSelect: () => revertEntityOverride(entityId) },
        null,
        { label: 'Select Prefab Instance', onSelect: () => setSelection([instance.owner]) },
        {
          label: 'Show Prefab in Project',
          disabled: owner === null || owner.missing,
          onSelect: () => {
            if (owner) useAssetStore.getState().reveal(owner.assetId);
          },
        },
      ];
    }

    // Built against `targets`, which is the clicked row when it is not in the
    // selection — the reason a command's context can be supplied rather than
    // only read. Labels, verdicts and bodies all come from the registry.
    const ctx = { selection: targets };
    const entry = (id: CommandId, shortcut?: string): MenuEntry => {
      const command = commandById(id);
      return {
        label: command?.label(ctx) ?? id,
        shortcut,
        disabled: !command?.can(ctx),
        onSelect: () => command?.run(ctx),
      };
    };

    return [
      // No shortcut shown: renaming is bound to double-click, not a key.
      {
        // The only gesture the registry cannot finish: what it does is put a
        // row into edit mode, and only this panel has rows. The verdict is the
        // registry's, the body stays here.
        label: 'Rename',
        disabled: !commandById('rename')?.can(ctx),
        onSelect: () => setRenaming(entityId),
      },
      entry('duplicate', `${modKey}D`),
      entry('delete', isMac ? '⌫' : 'Del'),
      null,
      ...(isPrefabHost
        ? ([
            {
              // The count is the question anyone asks before editing a prefab:
              // what exactly am I about to change.
              label: `Select All Instances${prefabInfo ? ` (${prefabInfo.siblings.length})` : ''}`,
              disabled: many,
              onSelect: () => selectPrefabInstances(entityId),
            },
            {
              label: 'Show Prefab in Project',
              disabled: many || prefabInfo === null || prefabInfo.missing,
              onSelect: () => {
                if (prefabInfo) useAssetStore.getState().reveal(prefabInfo.assetId);
              },
            },
            null,
            {
              label: 'Apply Overrides to Prefab',
              disabled: many || Object.keys(overridesOf(entityId)).length === 0,
              onSelect: () => void applyInstanceOverrides(entityId),
            },
            {
              label: 'Revert All Overrides',
              disabled: many || Object.keys(overridesOf(entityId)).length === 0,
              onSelect: () => revertInstanceOverrides(entityId),
            },
            {
              label: 'Unpack Prefab',
              disabled: many,
              onSelect: () => unpackPrefabInstance(entityId),
            },
          ] satisfies MenuEntry[])
        : []),
      ...(unpackable
        ? ([
            {
              // Unity's "Unpack Prefab", for a file: one entity per node, each
              // movable, hideable and re-materialable on its own.
              label: 'Unpack Model',
              onSelect: () => void unpackModel(entityId),
            },
            null,
          ] satisfies MenuEntry[])
        : []),
      {
        label: 'Create Prefab…',
        // One entity and its children. A prefab of several unrelated roots
        // would need a wrapper nobody asked for.
        disabled: many,
        onSelect: () => void createPrefabFromEntity(entityId),
      },
    ];
  };

  /**
   * @param index Position among the target's children, for a drop that landed
   *   between two rows rather than on one. Reordering siblings was impossible
   *   before, though `reparentEntity` has always taken an index — the panel
   *   simply never passed one.
   */
  const onDrop = (event: DragEvent, targetId: string | null, index?: number) => {
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(null);
    setDropBetween(null);

    const dragged = event.dataTransfer.getData(DRAG_MIME);
    if (!dragged) return;

    // The whole selection travels, not just the row under the pointer — which is
    // what dragging one of several highlighted rows plainly means.
    const ids = dragged.split(' ').filter((id) => id !== '');
    reparentSelection(Selection.of(ids, expandedScene().scene), targetId, index);
  };

  return (
    // Delete is handled once, globally, in useShortcuts. A panel-level handler
    // here also caught Backspace bubbling out of the search field and deleted
    // the selection instead of a character.
    <div className="flex h-full w-full flex-col bg-surface-1">
      <PanelToolbar>
        <Search size={12} className="ml-1 shrink-0 text-ink-dim" />
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Search"
          className="min-w-0 flex-1 bg-transparent px-1 text-2xs text-ink outline-none placeholder:text-ink-dim"
        />
      </PanelToolbar>

      <div
        ref={scrollRef}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        className="flex-1 overflow-auto py-1"
        // Dropping on empty space unparents, matching Unity's hierarchy.
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => onDrop(event, null)}
      >
        {rows.length === 0 && (
          <p className="px-3 py-2 text-2xs text-ink-dim">
            {filter ? 'No match.' : 'Empty scene — use the Add menu.'}
          </p>
        )}

        {/* Spacers stand in for the rows above and below, so the scrollbar is
            the size the whole tree would be while only what fits is rendered. */}
        {before > 0 && <div style={{ height: before * ROW_HEIGHT }} />}

        {visibleRows.map(({ entity, depth, hasChildren, instance }) => {
          const Icon = entityIcon(expanded, entity.id);
          const isSelected = selected.has(entity.id);
          // Reparenting an entity a prefab produced would have to move it in the
          // asset, which is not what dropping it here means.
          const draggable = instance === null && renaming !== entity.id;
          // An instance pointing at a prefab that is not in the project draws
          // nothing at all. Silence there reads as "my prefab is empty".
          const missing = findComponent(expanded, entity.id, 'prefabInstance');
          const broken = missing !== undefined && prefabs[missing.assetId] === undefined;

          return (
            <div
              key={entity.id}
              // Stable hook for automated checks and future end-to-end tests.
              data-entity-id={entity.id}
              draggable={draggable}
              onDragStart={(event) => {
                // Dragging a row that is part of the selection drags all of it;
                // dragging one outside it drags only that row, as right-clicking does.
                const payload = selected.has(entity.id) ? [...selected.ids] : [entity.id];
                event.dataTransfer.setData(DRAG_MIME, payload.join(' '));
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(event) => {
                if (instance) return;
                event.preventDefault();
                event.stopPropagation();
                // The top quarter of a row means "between this one and the one
                // above": Unity, Unreal and Blender all put reordering there, and
                // it is the only place it can go without a second gesture.
                const box = event.currentTarget.getBoundingClientRect();
                const between = event.clientY - box.top < box.height * 0.25;
                setDropBetween(between ? entity.id : null);
                setDropTarget(between ? null : entity.id);
              }}
              onDragLeave={() => {
                setDropTarget((current) => (current === entity.id ? null : current));
                setDropBetween((current) => (current === entity.id ? null : current));
              }}
              onDrop={(event) => {
                if (dropBetween !== entity.id) {
                  onDrop(event, entity.id);
                  return;
                }
                // Inserted where this row sits among its own siblings, under the
                // same parent it has.
                const parent = entity.parent;
                const siblings =
                  parent === null
                    ? useDocumentStore.getState().scene.rootOrder
                    : (useDocumentStore.getState().scene.entities[parent]?.children ?? []);
                onDrop(event, parent, Math.max(0, siblings.indexOf(entity.id)));
              }}
              onClick={(event) => onRowClick(event, entity.id)}
              onDoubleClick={() => setRenaming(entity.id)}
              onContextMenu={(event) => openMenu(event, entity.id)}
              style={{ paddingLeft: 4 + depth * INDENT_PX }}
              className={`group flex h-6 items-center gap-1 pr-1 text-2xs ${
                isSelected
                  ? 'bg-accent-dim text-ink'
                  : `${instance ? 'text-prefab/75' : 'text-ink-muted'} hover:bg-surface-2`
              } ${dropTarget === entity.id ? 'outline outline-1 -outline-offset-1 outline-accent' : ''} ${
                dropBetween === entity.id ? 'border-t border-accent' : ''
              }`}
            >
              <button
                type="button"
                tabIndex={-1}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleCollapsed(entity.id);
                }}
                className={`flex h-4 w-4 shrink-0 items-center justify-center ${hasChildren ? '' : 'invisible'}`}
              >
                {collapsed.has(entity.id) ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
              </button>

              <Icon size={12} className="shrink-0" />

              {renaming === entity.id ? (
                <input
                  // `preventScroll` rather than `autoFocus`: focusing an
                  // element scrolls every ancestor to reveal it, which is the
                  // same mechanism that moved the shell out of view.
                  ref={(element) => element?.focus({ preventScroll: true })}
                  defaultValue={entity.name}
                  onBlur={(event) => {
                    renameEntity(entity.id, event.target.value);
                    setRenaming(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                    if (event.key === 'Escape') setRenaming(null);
                    event.stopPropagation();
                  }}
                  className="min-w-0 flex-1 rounded-xs bg-surface-3 px-1 text-ink outline-none"
                />
              ) : (
                <span
                  title={broken ? 'This prefab is not in the project.' : undefined}
                  className={`min-w-0 flex-1 truncate ${entity.visible ? '' : 'opacity-45'} ${
                    broken ? 'text-error' : ''
                  }`}
                >
                  {entity.name}
                </span>
              )}

              <button
                type="button"
                tabIndex={-1}
                title={entity.visible ? 'Hide' : 'Show'}
                onClick={(event) => {
                  event.stopPropagation();
                  setEntityVisible(entity.id, !entity.visible);
                }}
                className={`shrink-0 ${entity.visible ? 'opacity-0 group-hover:opacity-60' : 'opacity-60'} hover:opacity-100`}
              >
                {entity.visible ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>

              <button
                type="button"
                tabIndex={-1}
                title="Delete object"
                // Hover-only, like the asset rows. Deleting is undoable, so the
                // cost of a mis-click is one Cmd+Z.
                onClick={(event) => {
                  event.stopPropagation();
                  // Through the command, like the menu entry above it: a
                  // padlock has to stop the row button too.
                  commandById('delete')?.run(
                    contextFor(
                      selected.has(entity.id) ? [...selected.ids] : [entity.id],
                    ),
                  );
                }}
                className="shrink-0 opacity-0 hover:text-error group-hover:opacity-60"
              >
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}

        {after > 0 && <div style={{ height: after * ROW_HEIGHT }} />}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.entityId)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
