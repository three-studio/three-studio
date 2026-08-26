import {
  deleteComponent,
  entitiesFromNodes,
  findComponent,
  insertEntity,
  type ModelNode,
} from '@three-studio/core';
import { askToConfirm } from '../state/dialogStore';
import { useDocumentStore } from '../state/documentStore';
import { notify } from '../state/toastStore';
import { peekViewport } from '../viewport/viewportHost';

/*
 * Taking an imported model apart.
 *
 * A model arrives as one entity drawing a whole file, which is right for placing
 * a prop and useless the moment the author wants to move one door, hide one
 * bolt, or give one panel a different material. Every engine answers this the
 * same way and calls it the same thing: Unity's "Unpack Prefab", Godot's "Make
 * Local". This is that, for a model.
 *
 * One-way, deliberately. The pieces stop following the file, which is the point
 * — a link that is sometimes live is the thing nobody can reason about later.
 * What makes it cheap is that the pieces are ordinary entities carrying ordinary
 * `model` components: the gizmo, the hierarchy, undo, prefabs, the play-mode
 * snapshot and the web export all already work on them.
 */

/** Past this many nodes it is worth saying how many before writing them. */
const CONFIRM_ABOVE = 200;

/**
 * Replaces a model entity with one entity per node of its file.
 *
 * The host keeps its place, its name and everything else the author put on it;
 * only the `model` goes, replaced by the sub-tree it was drawing.
 */
export async function unpackModel(entityId: string): Promise<void> {
  const document = useDocumentStore.getState();
  const host = document.scene.entities[entityId];
  const component = findComponent(document.scene, entityId, 'model');
  if (!host || !component || component.assetId === '') return;

  if (component.nodePath !== '') {
    notify({
      kind: 'warning',
      title: 'Already unpacked',
      description: 'This entity draws a single node of its file.',
    });
    return;
  }

  /*
   * Through the viewport's own cache, not a load of this command's own.
   *
   * The paths written below are indices into the tree **as the import settings
   * dress it**, and that is the tree `ModelSystem` will resolve them against. A
   * second, undressed load would hand back paths pointing at different nodes,
   * and the failure would be an unpacked model whose pieces are the wrong
   * pieces — which reads as a corrupt file rather than as a mismatch.
   */
  const binder = peekViewport()?.binder;
  if (!binder) return;

  let shape;
  try {
    shape = await binder.modelShape(component.assetId);
  } catch (cause) {
    console.error(`[unpack] could not read ${component.assetId}`, cause);
    notify({
      kind: 'warning',
      title: 'Nothing to unpack',
      description: 'This entity points at a model the project cannot load.',
    });
    return;
  }

  if (shape.skinned) {
    notify({
      kind: 'warning',
      title: 'Skinned models cannot be unpacked',
      description:
        'Its meshes read their pose from bones elsewhere in the same tree, and splitting it would leave them pointing at nothing.',
    });
    return;
  }

  const nodes: readonly ModelNode[] = shape.nodes;
  if (nodes.length > CONFIRM_ABOVE) {
    const go = await askToConfirm({
      title: 'Unpack this model?',
      message: `It will become ${nodes.length} entities in the hierarchy. This cannot be relinked to the file afterwards.`,
      confirmLabel: 'Unpack',
    });
    if (!go) return;
  }

  const unpacked = entitiesFromNodes(nodes, component.assetId, host.name);
  const root = unpacked[0];
  if (!root) return;

  useDocumentStore.getState().mutate(
    'Unpack model',
    (draft) => {
      if (!draft.entities[entityId]) return;

      // The model component goes; everything else the author put on the host —
      // a collider, a script, a rigid body — stays, which is what "unpack"
      // means.
      for (const held of Object.values(draft.components.model[entityId] ?? {})) {
        deleteComponent(draft, entityId, held.id);
      }

      /*
       * The root under the host, every other node under the entity its parent
       * produced. `entitiesFromNodes` hands them back parents first, so
       * `insertEntity` never has to look ahead — and `linkEntity`, inside it,
       * is what writes both ends of the edge.
       */
      for (const { template, parentId } of unpacked) {
        insertEntity(draft, template, parentId ?? entityId);
      }
    },
    { select: [root.template.entity.id] },
  );

  notify({
    kind: 'success',
    title: `Unpacked into ${unpacked.length} ${unpacked.length === 1 ? 'entity' : 'entities'}`,
  });
}
