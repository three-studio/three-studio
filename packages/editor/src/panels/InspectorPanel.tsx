import { componentsOf, splitInstancedId, type ComponentType } from '@three-studio/core';
import { Boxes, Plus, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { addComponentWithDependencies, componentFits } from '../commands/sceneCommands';
import { revertEntityOverride } from '../commands/prefabCommands';
import { InspectorBinding, inspectorSignature } from '../inspector/buildInspector';
import { COMPONENT_SCHEMAS, sceneSignature } from '../inspector/schema';
import { useAssetStore } from '../state/assetStore';
import { useDocumentStore } from '../state/documentStore';
import { expandedScene } from '../state/expansion';
import { Selection } from '../state/selection';
import { useEditorStore } from '../state/editorStore';
import { useScriptStore } from '../state/scriptStore';
import { Menu } from '../ui/Menu';

/** Components a user can attach by hand; `model` comes from dropping an asset. */
const ADDABLE: readonly ComponentType[] = [
  'mesh',
  'light',
  'camera',
  'rigidbody',
  'collider',
  'audioSource',
  'audioListener',
  'playerController',
  'script',
];

export function InspectorPanel() {
  const selection = useEditorStore((s) => s.selection);
  // The environment alone, not the document: immer keeps the identity of what a
  // mutation did not touch, so moving an entity does not re-key the scene pane.
  const environment = useDocumentStore((s) => s.scene.environment);
  // Named rather than recomputed: `isSingle` is one of the three cases nobody
  // had a word for, and the panel is where the missing word was most obvious.
  const selected = Selection.of(selection, expandedScene().scene);
  const entityId = selected.isSingle ? selected.primary ?? undefined : undefined;
  /*
   * The selected entity, not the whole scene.
   *
   * Immer keeps the identity of anything a mutation did not touch, so this
   * reference is an exact "the thing on screen changed". Subscribing to `scene`
   * refreshed every Tweakpane binding on *every* mutation — dragging one cube
   * refreshed the Inspector of a different one, sixty times a second.
   *
   * For an id a prefab produced, the document entity is the instance that placed
   * it: that is where an override is written, so it is the right thing to watch.
   */
  const watched = useDocumentStore((state) => {
    if (entityId === undefined) return undefined;
    const parts = splitInstancedId(entityId);
    return state.scene.entities[parts === null ? entityId : parts.owner];
  });
  /*
   * And the components, which the entity above cannot speak for.
   *
   * Since phase 10 a component lives in `scene.components`, not in its entity,
   * so **adding, editing or removing one moves nothing in `watched`**. The panel
   * therefore showed a freshly added component only once something else happened
   * to wake it — a gizmo drag, a reselection — and undoing an edit to a
   * component field left the value that had just been taken back on screen.
   */
  const componentRevision = useDocumentStore((s) => s.componentRevision);

  // Prefab instances are part of the shape here: their contents are selectable
  // and have to be inspectable, and editing a prefab changes what fields exist
  // without touching the document.
  const prefabs = useAssetStore((s) => s.prefabs);
  const entity = entityId === undefined ? undefined : expandedScene().scene.entities[entityId];
  const instance = entityId === undefined ? null : splitInstancedId(entityId);

  const containerRef = useRef<HTMLDivElement>(null);
  const bindingRef = useRef<InspectorBinding | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  // The pane is rebuilt only when the *shape* of the entity changes; ordinary
  // value edits are pushed through `refresh`, which keeps focus and drag state.
  // The script build revision is part of that shape, so recompiling brings new
  // script properties into the panel.
  const scriptRevision = useScriptStore((s) => s.revision);
  // Editing a shared material changes which fields exist without touching the
  // document, so the material table is part of the shape too.
  const materials = useAssetStore((s) => s.materials);
  // So are the assets themselves: a dropdown's options are computed when the
  // pane is built, so importing a texture has to rebuild it or the new file
  // cannot be chosen without deselecting and selecting again.
  const assetRevision = useAssetStore((s) => s.revision);
  // With nothing selected the pane is the scene's own — Blender's Scene tab —
  // so the shape that decides a rebuild is the scene's, not an entity's. Both
  // signatures carry what they identify, so one key serves both panes.
  const signature = useMemo(() => {
    // The script revision is already inside `inspectorSignature`.
    if (selection.length === 0) return `${sceneSignature(environment)}#${assetRevision}`;
    if (entityId !== undefined) return `${inspectorSignature(entityId)}#${assetRevision}`;

    /*
     * For several, the shape is the shapes of all of them.
     *
     * The panel shows the components they have in common, so it has to be rebuilt
     * when any one of them gains or loses one — and the ids are in it too, since
     * selecting a different set of the same shapes is a different pane.
     */
    const shapes = selection.map((id) => `${id}:${inspectorSignature(id)}`).join('|');
    return `${shapes}#${assetRevision}`;
    // `componentRevision` moves on every write under `components`, including a
    // slider mid-drag. That costs one string rebuild: the value comes out the
    // same, the effect below does not re-run, and only `refresh()` — which is
    // what a drag wants anyway — reaches the pane.
  }, [
    selection,
    entityId,
    environment,
    entity,
    scriptRevision,
    assetRevision,
    materials,
    prefabs,
    componentRevision,
  ]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || signature === '') return;

    const binding = new InspectorBinding(
      container,
      entityId !== undefined
        ? { kind: 'entity', entityId }
        : selection.length > 1
          ? { kind: 'entities', ids: selection }
          : { kind: 'scene' },
    );
    bindingRef.current = binding;
    return () => {
      bindingRef.current = null;
      binding.dispose();
    };
  }, [signature, entityId, selection]);

  // Materials are in here as well as the scene: undoing an edit to a shared
  // material changes no entity, so without it the panel kept showing the value
  // that had just been taken back.
  //
  // And the environment for exactly the same reason. `watched` is the selected
  // entity, and the scene pane is what shows when nothing is selected — so
  // there was no dependency in this list that a background or a sky edit could
  // move, and nothing here rebuilds the pane either: `sceneSignature` carries
  // the modes, which decide the *rows*, not their values. Undo therefore took
  // the change back in the viewport and left every slider reading what had just
  // been undone.
  //
  // And `componentRevision`, for the half of the same problem that was not the
  // pane's shape but its values: every field the panel shows below the transform
  // reads a component, and no dependency here could move when one changed.
  useEffect(() => {
    bindingRef.current?.refresh();
  }, [watched, environment, materials, prefabs, componentRevision]);



  // Selected, but gone from the expansion — a prefab that no longer produces it.
  if (selection.length === 1 && !entity) return null;

  const existing = new Set(
    entityId === undefined
      ? []
      : componentsOf(expandedScene().scene, entityId).map((component) => component.type),
  );

  return (
    <div className="flex h-full w-full flex-col bg-surface-1">
      {instance && <PrefabBanner id={entityId!} depth={instance.depth} />}
      <div ref={containerRef} className="min-h-0 flex-1 overflow-auto p-1.5" />

      {/* The scene pane has nothing to add a component to. */}
      {entity && (
        <div className="relative shrink-0 border-t border-line p-2">
          <button
            type="button"
            disabled={instance !== null}
            onClick={() => setAddOpen((open) => !open)}
            className="flex h-7 w-full items-center justify-center gap-1.5 rounded-sm bg-surface-3 text-2xs text-ink hover:bg-surface-4"
          >
            <Plus size={13} />
            Add Component
          </button>
          {addOpen && (
            <div className="absolute inset-x-2 bottom-2">
              <Menu
                placement="above"
                onClose={() => setAddOpen(false)}
                items={ADDABLE.map((type) => ({
                  label: COMPONENT_SCHEMAS[type].label,
                  // A second mesh or camera on one entity has no meaning here —
                  // and neither does a mesh on something already drawing a
                  // model, which `componentFits` is what answers.
                  disabled:
                    (existing.has(type) && type !== 'collider' && type !== 'script') ||
                    !componentFits(type, existing),
                  onSelect: () => addComponentWithDependencies(entity.id, type),
                }))}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Says why this entity is not quite the scene's own, because otherwise an edit
 * that lands somewhere unexpected — on the instance, not on the prefab — is
 * indistinguishable from one that did nothing.
 */
function PrefabBanner({ id, depth }: { id: string; depth: number }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-line bg-prefab/10 px-2 py-1.5">
      <Boxes size={12} className="shrink-0 text-prefab" />
      <span className="min-w-0 flex-1 text-2xs text-ink-dim">
        {depth === 1
          ? 'From a prefab — edits are kept on this instance.'
          : `Inside ${depth} prefabs — edits are kept on the instance in this scene.`}
      </span>
      {(
        <button
          type="button"
          title="Revert to the prefab"
          onClick={() => revertEntityOverride(id)}
          className="flex h-5 shrink-0 items-center gap-1 rounded-sm px-1.5 text-2xs text-ink-dim hover:bg-surface-3 hover:text-ink"
        >
          <RotateCcw size={11} />
          Revert
        </button>
      )}
    </div>
  );
}
