import { COMPONENT_TYPES, hasComponent, type ComponentType, type SceneDoc } from '@three-studio/core';
import { OVERLAYS } from '../../components/overlays';
import type { EntityMarker } from '../../components/registry';

/*
 * Which entities get a marker in the viewport, and what it looks like.
 *
 * Pure, and deliberately so: "does this entity draw anything" is a question
 * about the document, and answering it here rather than inside `EntityMarkers`
 * is what lets a test ask it without a scene graph.
 */

/** What `EntityMarkers` draws. The ranking beside it is this file's business. */
export type MarkerStyle = Pick<EntityMarker, 'color' | 'pixels'>;

/**
 * The types that draw geometry of their own, so the check below stays three
 * lookups and not twelve.
 *
 * An entity carrying one is already clickable, and a marker on top of it would
 * be an icon nobody needs and a click target fighting the mesh behind it. Every
 * type answers, in its own folder — a type left out of a list drew geometry
 * *and* got a marker on top of it, with nothing anywhere to say that was meant.
 */
const RENDERS: readonly ComponentType[] = COMPONENT_TYPES.filter(
  (type) => OVERLAYS[type].drawsGeometry,
);

/**
 * The types worth marking, best first.
 *
 * The rank is a number on the marker rather than the key order of a table here,
 * because the marker is declared in the type's own folder. Still a separate
 * decision from `HierarchyPanel`'s `ICON_PRIORITY`, and for the reason that
 * file gives: the order is about *this* display, not about the types.
 */
const PRIORITY: readonly ComponentType[] = COMPONENT_TYPES.filter(
  (type) => OVERLAYS[type].marker !== null,
).sort((a, b) => OVERLAYS[a].marker!.priority - OVERLAYS[b].marker!.priority);

export const MARKED_TYPES: readonly ComponentType[] = PRIORITY;

/** Whether the entity contributes no geometry of its own. */
export function drawsNothing(scene: SceneDoc, entityId: string): boolean {
  return !RENDERS.some((type) => hasComponent(scene, entityId, type));
}

/**
 * The marker an entity should carry, or `undefined` when it needs none.
 *
 * An entity carrying nothing at all gets none. It used to get a grey one, and
 * the entity that showed why it was wrong is the `Scene` node every new scene
 * opens with: a marker there says "an entity is at the origin", which the
 * hierarchy already says better. ADR-13 rules out treating that node as a
 * special case — it is "une entité ordinaire, ni protégée, ni spéciale" — so the
 * rule has to hold for every bare entity, and it does: a group is scaffolding,
 * and what hangs under it is what an author clicks.
 *
 * Every lookup below is against a component table, never a walk of the entity
 * table — see ADR-16.
 */
export function markerStyleFor(scene: SceneDoc, entityId: string): MarkerStyle | undefined {
  if (scene.entities[entityId] === undefined) return undefined;
  if (!drawsNothing(scene, entityId)) return undefined;

  for (const type of PRIORITY) {
    const marker = OVERLAYS[type].marker;
    if (marker !== null && hasComponent(scene, entityId, type)) return marker;
  }
  return undefined;
}
