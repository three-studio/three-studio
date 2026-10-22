import {
  COMPONENT_TYPES,
  capabilitiesOf,
  componentDefinition,
  findBrokenReferences,
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
  Clapperboard,
  Eye,
  EyeOff,
  FileCode,
  Lightbulb,
  Move,
  Search,
  Shapes,
  Sparkles,
  Trash2,
  Volume2,
  Waves,
  Weight,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { commandById, contextFor, contextForAsset, type CommandId } from '../commands/registry';
import {
  renameEntity,
  reparentSelection,
} from '../commands/sceneCommands';
import { hasModifier } from '../platform';
import { instanceInfo } from '../commands/prefabCommands';
import { commandEntry } from '../shell/commandEntry';
import { knownAssetIds } from '../state/brokenReport';
import { expandedScene } from '../state/expansion';
import { isBetweenRows, insertionAt, rangeSelection } from './hierarchyGestures';
import { buildRows, type Row } from './hierarchyRows';
import { ROW_HEIGHT, rowWindow } from './hierarchyWindow';
import { Selection } from '../state/selection';
import { useAssetStore } from '../state/assetStore';
import { usePrefabModeStore } from '../state/prefabModeStore';
import { useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import { selectSceneName, useProjectStore } from '../state/projectStore';
import { ContextMenu, type MenuEntry } from '../ui/Menu';
import { tooltip } from '../ui/Tooltip';
import { PanelToolbar } from './PanelShell';

const DRAG_MIME = 'application/x-studio-entity';
const INDENT_PX = 12;

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
  sparkles: Sparkles,
  volume: Volume2,
  waves: Waves,
  weight: Weight,
};

/**
 * Which component decides a row's icon when an entity has several, lowest first.
 *
 * Ordering is a decision about this tree, not about the types, so it stays here:
 * a prefab instance is what the row *is*, whatever else got added to it.
 *
 * Total rather than a list of the six that matter, because the six that matter
 * are not the interesting half: a type left out of a list is unranked *and*
 * unnoticed, and it draws a generic box with nothing anywhere to say that was a
 * decision. Every type now answers, and `FALLS_THROUGH` is the answer "this one
 * does not decide" — which is what a mesh, a model or a bare entity has always
 * drawn.
 */
const FALLS_THROUGH = Number.POSITIVE_INFINITY;

const ICON_PRIORITY: Record<ComponentType, number> = {
  prefabInstance: 1,
  light: 2,
  camera: 3,
  // After the three above and before the fall-through: an entity that is a
  // sound and nothing else is very common — a dropped clip makes one — and a
  // row of identical boxes is a hierarchy nobody can scan.
  audioSource: 4,
  audioListener: 5,
  // Last of the named types and still ahead of the fall-through: a water
  // surface would otherwise draw the same box as a mesh, and the one thing a
  // hierarchy row has to say is what the entity is.
  water: 6,
  // Beside water, and for the same reason: an emitter draws nothing an
  // author can click, so the row is the only place the tree can say what it is.
  particleEmitter: 7,
  mesh: FALLS_THROUGH,
  model: FALLS_THROUGH,
  collider: FALLS_THROUGH,
  rigidbody: FALLS_THROUGH,
  script: FALLS_THROUGH,
  playerController: FALLS_THROUGH,
};

/** The ranked types, best first. Derived, so the two cannot disagree. */
const RANKED_TYPES = COMPONENT_TYPES.filter((type) => ICON_PRIORITY[type] !== FALLS_THROUGH).sort(
  (a, b) => ICON_PRIORITY[a] - ICON_PRIORITY[b],
);

function entityIcon(scene: SceneDoc, entityId: string): LucideIcon {
  for (const type of RANKED_TYPES) {
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
  // Likewise for what the project holds: deleting an asset breaks the rows that
  // name it, and nothing about the document changes when it goes.
  const assetRevision = useAssetStore((s) => s.revision);
  const selection = useEditorStore((s) => s.selection);
  const setSelection = useEditorStore((s) => s.setSelection);
  // One value for the whole render, memoised on `(ids, scene)`: `has()` is asked
  // once per row, and rebuilding a Set per row is the cost this removes.
  const expanded = expandedScene().scene;
  const selected = Selection.of(selection, expanded);

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = useState('');
  // The store's, not this panel's: a command has to be able to start a rename,
  // and only something outside the panel can be reached from a menu, a key or a
  // palette. See `editorStore.renaming`.
  const renaming = useEditorStore((s) => s.renaming);
  const endRename = useEditorStore((s) => s.endRename);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  /** The row a between-rows drop would land above, for the insertion line. */
  const [dropBetween, setDropBetween] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entityId: string } | null>(null);

  const rows = useMemo(
    () => buildRows(expandedScene(), collapsed, filter),
    [structureRevision, prefabs, collapsed, filter],
  );

  /*
   * The rows whose components name an asset the project does not have.
   *
   * One walk for the whole tree rather than one question per row, which is the
   * same reason `selected` is built once above: this is asked for every row of
   * a list that can be four thousand long.
   *
   * `revision` rather than the manifest itself, because the manifest is
   * replaced on every mutation and this only has to move when what the project
   * *holds* changes.
   */
  const brokenBy = useMemo(() => {
    const byEntity = new Map<string, string[]>();
    for (const { entityId, assetId } of findBrokenReferences(expandedScene().scene, knownAssetIds())) {
      // The environment is not a row. It is reported at load and shown in the
      // Inspector; there is nothing here to mark.
      if (entityId === null) continue;
      const named = byEntity.get(entityId);
      if (named) named.push(assetId);
      else byEntity.set(entityId, [assetId]);
    }
    return byEntity;
  }, [structureRevision, prefabs, assetRevision]);

  /* Only the rows that fit are rendered; the arithmetic is `rowWindow`. */
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

  const { first, last, above, below } = rowWindow(rows.length, scrollTop, height);
  const visibleRows = rows.slice(first, last);

  const toggleCollapsed = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onRowClick = (event: MouseEvent, id: string) => {
    if (event.shiftKey) {
      // A range, from whatever was picked last. `null` when either end is off
      // the list — a filter can hide the anchor — and the click is then plain.
      const range = rangeSelection(rows, selected.primary, id);
      if (range) {
        setSelection(range);
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

    // Built against `targets`, which is the clicked row when it is not in the
    // selection — the reason a command's context can be supplied rather than
    // only read. Labels, verdicts and bodies all come from the registry.
    const ctx = { selection: targets };
    const entry = (id: CommandId): MenuEntry => commandEntry(id, ctx);

    // A produced entity belongs to a prefab, not to the scene. Renaming it is an
    // override and works; adding or removing one is a change to the asset, and
    // an item that silently does nothing is worse than one that is greyed out.
    if (instance) {
      const owner = instanceInfo(instance.owner);
      return [
        entry('rename'),
        entry('revertEntityOverride'),
        null,
        { label: 'Select Prefab Instance', onSelect: () => setSelection([instance.owner]) },
        // The owner's asset, not this row's: the context here names the produced
        // entity, and what is being revealed is the prefab it came out of.
        {
          label: 'Show Prefab in Project',
          disabled: owner === null || owner.missing,
          onSelect: () => {
            if (owner) commandById('revealAsset').run(contextForAsset(owner.assetId));
          },
        },
      ];
    }

    return [
      // No shortcut shown: renaming is bound to double-click, not a key.
      // Label, verdict and body all the command's now — the body used to stay
      // here because the registry had no way to ask a view for a text field.
      entry('rename'),
      entry('duplicate'),
      entry('delete'),
      null,
      ...(isPrefabHost
        ? ([
            // The count in the label is the command's now, so the Inspector's
            // button carries it too.
            entry('selectPrefabInstances'),
            {
              label: 'Show Prefab in Project',
              disabled: many || prefabInfo === null || prefabInfo.missing,
              onSelect: () => {
                if (prefabInfo) commandById('revealAsset').run(contextForAsset(prefabInfo.assetId));
              },
            },
            null,
            entry('applyPrefabOverrides'),
            entry('revertPrefabOverrides'),
            entry('unpackPrefab'),
          ] satisfies MenuEntry[])
        : []),
      // Left out rather than greyed, because it applies to almost nothing: the
      // entry belongs to an entity that still draws a whole file. Asked of the
      // command rather than recomputed here — this row used to carry its own
      // copy of the three conditions. Kept, greyed, while it only waits for
      // Stop: a row that vanished at Play would say nothing about why.
      ...(commandById('unpackModel').can(ctx) || commandById('unpackModel').waitsForStop(ctx)
        ? ([
            // Unity's "Unpack Prefab", for a file: one entity per node, each
            // movable, hideable and re-materialable on its own.
            entry('unpackModel'),
            null,
          ] satisfies MenuEntry[])
        : []),
      entry('createPrefab'),
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

      <SceneHeader onDrop={(event) => onDrop(event, null)} />

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
        {above > 0 && <div style={{ height: above }} />}

        {visibleRows.map(({ entity, depth, hasChildren, instance }) => {
          const Icon = entityIcon(expanded, entity.id);
          const isSelected = selected.has(entity.id);
          // Reparenting an entity a prefab produced would have to move it in the
          // asset, which is not what dropping it here means.
          const draggable = instance === null && renaming !== entity.id;
          // A row naming anything the project does not have — a prefab, a model,
          // a texture in a material slot. It used to be prefabs only, and the
          // reason applies to all of them: an entity that draws nothing reads as
          // an entity that is empty.
          const missing = brokenBy.get(entity.id);

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
                const box = event.currentTarget.getBoundingClientRect();
                const between = isBetweenRows(event.clientY - box.top, box.height);
                setDropBetween(between ? entity.id : null);
                setDropTarget(between ? null : entity.id);
              }}
              onDragLeave={() => {
                setDropTarget((current) => (current === entity.id ? null : current));
                setDropBetween((current) => (current === entity.id ? null : current));
              }}
              onDrop={(event) => {
                // Inserted where this row sits among its own siblings, under the
                // same parent it has.
                const at =
                  dropBetween === entity.id
                    ? insertionAt(useDocumentStore.getState().scene, entity.id)
                    : null;
                if (at === null) {
                  onDrop(event, entity.id);
                  return;
                }
                onDrop(event, at.parent, at.index);
              }}
              onClick={(event) => onRowClick(event, entity.id)}
              // Through the command, like the menu entry: the double-click used
              // to walk straight past `can('rename')`.
              onDoubleClick={() => commandById('rename').run(contextFor([entity.id]))}
              onContextMenu={(event) => openMenu(event, entity.id)}
              // The height is the windowing's, not a class of its own: `h-6`
              // beside a `ROW_HEIGHT` of 24 was one number in two languages,
              // and the arithmetic is *on* that number — the two parting would
              // not break a layout, it would scroll to the wrong rows.
              style={{ height: ROW_HEIGHT, paddingLeft: 4 + depth * INDENT_PX }}
              className={`group flex cursor-pointer items-center gap-1 pr-1 text-2xs ${
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
                    endRename();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                    if (event.key === 'Escape') endRename();
                    event.stopPropagation();
                  }}
                  className="min-w-0 flex-1 rounded-xs bg-surface-3 px-1 text-ink outline-none"
                />
              ) : (
                <span
                  {...tooltip(missing ? `Not in this project: ${missing.join(', ')}` : undefined)}
                  className={`min-w-0 flex-1 truncate ${entity.visible ? '' : 'opacity-45'} ${
                    missing ? 'text-error' : ''
                  }`}
                >
                  {entity.name}
                </span>
              )}

              <button
                type="button"
                tabIndex={-1}
                aria-label={entity.visible ? 'Hide' : 'Show'}
                {...tooltip(entity.visible ? 'Hide' : 'Show')}
                onClick={(event) => {
                  event.stopPropagation();
                  // Through the command, like the delete button below it. The
                  // row's own entity, not the selection: this eye belongs to
                  // this line.
                  commandById('toggleVisibility').run(contextFor([entity.id]));
                }}
                className={`shrink-0 ${entity.visible ? 'opacity-0 group-hover:opacity-60' : 'opacity-60'} hover:opacity-100`}
              >
                {entity.visible ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>

              <button
                type="button"
                tabIndex={-1}
                aria-label="Delete object"
                {...tooltip('Delete object')}
                // Hover-only, like the asset rows. Deleting is undoable, so the
                // cost of a mis-click is one Cmd+Z.
                onClick={(event) => {
                  event.stopPropagation();
                  // Through the command, like the menu entry above it: a
                  // padlock has to stop the row button too.
                  commandById('delete').run(
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

        {below > 0 && <div style={{ height: below }} />}
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

/**
 * The scene, above everything in it: the one line of the tree that is not an
 * entity.
 *
 * A row is an entity, with a trash button, a context menu and a drag handle,
 * and the scene is none of those. Scenes have long carried an empty entity
 * called `Scene` at the top of the list: it read as the scene itself, and
 * deleting it changed nothing, because the scene was never in the list. What
 * the scene has of its own is the Inspector's pane with nothing selected, so
 * that is what a click here asks for, and nothing here deletes or renames.
 *
 * Not a row the others are nested under either, the way Unity draws its scene:
 * that costs every line of the tree one indent step to say what this one line
 * already says. The icon sits in the rows' chevron column instead, which puts
 * the name where a root row draws its icon, and the rows read as inside it
 * without moving.
 *
 * Outside the scrolled list, so it stays on screen however long the list grows.
 * It is the way to the scene's settings, and the place to drop an object to
 * bring it back to the root — which the empty space under the rows does too,
 * until the list is long enough to leave none. And `rowWindow` goes on counting
 * rows and nothing else.
 */
function SceneHeader({ onDrop }: { onDrop: (event: DragEvent) => void }) {
  const sceneName = useProjectStore(selectSceneName);
  // With a prefab open the document is the prefab, and so is the list under
  // this line: naming the scene there would name something not on screen.
  const prefabName = usePrefabModeStore((s) => s.stack.at(-1)?.name ?? null);
  // Lit exactly when the Inspector shows the scene's pane — the test
  // `InspectorPanel` makes — so the two cannot disagree about what is in front.
  const isSubject = useEditorStore((s) => s.selection.length === 0);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const [dropping, setDropping] = useState(false);

  const Icon = prefabName === null ? Clapperboard : Boxes;

  return (
    <div
      // Stable hook for automated checks, beside the rows' `data-entity-id`.
      data-scene-header
      {...tooltip(prefabName === null ? 'Scene settings' : undefined)}
      onClick={() => clearSelection()}
      onDragOver={(event) => {
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(event) => {
        setDropping(false);
        onDrop(event);
      }}
      style={{ height: ROW_HEIGHT }}
      className={`flex shrink-0 cursor-pointer items-center gap-1 border-b border-line pl-1 pr-1 text-2xs text-ink ${
        isSubject ? 'bg-accent-dim' : 'hover:bg-surface-2'
      } ${dropping ? 'outline outline-1 -outline-offset-1 outline-accent' : ''}`}
    >
      {/* The size of a row's chevron button, which is what puts the name over
          the root rows' icons. */}
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        <Icon size={12} className={prefabName === null ? undefined : 'text-prefab'} />
      </span>
      <span className="min-w-0 flex-1 truncate">{prefabName ?? sceneName ?? 'Scene'}</span>
    </div>
  );
}
