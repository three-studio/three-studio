import type { SceneDoc } from '@three-studio/core';
import type { Row } from './hierarchyRows';

/*
 * What a gesture on a hierarchy row means, decided away from the row.
 *
 * These are the last two rules that were written inside `HierarchyPanel.tsx`,
 * where nothing could reach them: the tests run with `environment: 'node'`, so
 * a rule inside a component is a rule nobody runs. Both are arithmetic over
 * values the panel already has — a pointer offset, a flat array of rows — and
 * neither needs a DOM, which is why they come out rather than the DOM going in.
 */

/**
 * The band at the top of a row that means "between this row and the one above"
 * rather than "onto this row".
 *
 * A quarter, because Unity, Unreal and Blender all put reordering there and it
 * is the only place it can go without a second gesture. Wider and dropping a
 * child onto a parent becomes hard to aim; narrower and reordering does.
 */
export const BETWEEN_ROWS_BAND = 0.25;

/** Whether a pointer `offsetY` into a row of `rowHeight` means "between rows". */
export function isBetweenRows(offsetY: number, rowHeight: number): boolean {
  return offsetY < rowHeight * BETWEEN_ROWS_BAND;
}

/**
 * Where a between-rows drop on `entityId` lands: the parent that row already
 * has, and the row's own place among its siblings.
 *
 * `null` when the scene does not hold the entity — an instanced row, which the
 * panel refuses to drop between anyway, or a row from an expansion that has
 * since gone. The caller then treats the drop as an ordinary one onto the row,
 * which `reparentSelection` will refuse on its own terms rather than land in an
 * order this cannot compute.
 *
 * Read from **one** scene, where the panel read the parent off the expanded
 * scene and the siblings off the document. The two agree for every entity that
 * can be dropped between; asking one of them is what makes that true instead of
 * merely likely.
 */
export function insertionAt(
  scene: SceneDoc,
  entityId: string,
): { parent: string | null; index: number } | null {
  const entity = scene.entities[entityId];
  if (!entity) return null;

  const siblings =
    entity.parent === null ? scene.rootOrder : (scene.entities[entity.parent]?.children ?? []);

  // Clamped because `indexOf` answers -1 for an entity its own parent does not
  // list — the torn hierarchy the graph module now refuses to create. A drop at
  // -1 would insert at the end of the array from the other side, silently.
  return { parent: entity.parent, index: Math.max(0, siblings.indexOf(entityId)) };
}

/**
 * The selection a shift-click produces: every row between the anchor and the
 * one clicked, inclusive, in either direction.
 *
 * `null` when either end is not on screen — a filter can hide the anchor — and
 * the click is then an ordinary one.
 *
 * The rows are a flat array, so this is two indices and a slice. That is the
 * second thing flattening paid for: the first was the 404 ms per gizmo nudge it
 * removed from the row model.
 */
export function rangeSelection(
  rows: readonly Row[],
  anchor: string | null,
  clicked: string,
): string[] | null {
  const from = rows.findIndex((row) => row.entity.id === (anchor ?? clicked));
  const to = rows.findIndex((row) => row.entity.id === clicked);
  if (from === -1 || to === -1) return null;

  const [start, end] = from <= to ? [from, to] : [to, from];
  const span = rows.slice(start, end + 1).map((row) => row.entity.id);
  // The clicked row goes last, so it stays the primary and the gizmo does not
  // jump to the far end of the range the user just swept.
  return [...span.filter((other) => other !== clicked), clicked];
}
