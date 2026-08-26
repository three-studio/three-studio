import { splitInstancedId, type EntityDoc, type ExpandedScene } from '@three-studio/core';
import { expandedChildren } from '../state/expansion';

/** One line of the hierarchy, already flattened and indented. */
export interface Row {
  entity: EntityDoc;
  depth: number;
  hasChildren: boolean;
  /** Set for an entity a prefab produced: shown, selectable, but not the scene's. */
  instance: { owner: string; local: string; depth: number } | null;
}

/**
 * Flattens the tree into visible rows, honouring collapsed nodes and the filter.
 *
 * Walks the *expanded* scene, so what a prefab places is on screen rather than
 * hidden behind a leaf that claims to have no children. Unity shows the same
 * sub-tree and tints it; a prefab you cannot open is a black box, and there is
 * then no way to reach a child in order to override anything on it.
 *
 * Extracted from the panel because it is a pure function of its arguments and was
 * unreachable from a test inside a component module. Worth doing on its own, and
 * the panel is where the row model's cost was hiding: `bee3e28` measured 422ms
 * per gizmo nudge at 4009 rows, of which 404ms was here and 0.5ms was the
 * mutation.
 */
export function buildRows(
  expanded: ExpandedScene,
  collapsed: ReadonlySet<string>,
  filter: string,
): Row[] {
  const scene = expanded.scene;
  const rows: Row[] = [];
  const needle = filter.trim().toLowerCase();
  const produced = expandedChildren(expanded);

  const childrenOf = (entity: EntityDoc): readonly string[] => {
    const extra = produced.get(entity.id);
    return extra ? [...entity.children, ...extra] : entity.children;
  };

  const walk = (ids: readonly string[], depth: number) => {
    for (const id of ids) {
      const entity = scene.entities[id];
      if (!entity) continue;

      const children = childrenOf(entity);
      const hasChildren = children.length > 0;
      const row = { entity, depth, hasChildren, instance: splitInstancedId(id) };
      // A filter flattens the tree: matching entities are shown wherever they
      // are, because hiding a match behind a collapsed ancestor is useless.
      if (needle === '') {
        rows.push(row);
        if (hasChildren && !collapsed.has(id)) walk(children, depth + 1);
      } else {
        if (entity.name.toLowerCase().includes(needle)) {
          rows.push({ ...row, depth: 0, hasChildren: false });
        }
        walk(children, depth + 1);
      }
    }
  };

  walk(scene.rootOrder, 0);
  return rows;
}
