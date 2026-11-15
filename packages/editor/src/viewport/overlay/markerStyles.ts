import {
  hasComponent,
  type ComponentTypeId,
  type EntityId,
  type Registry,
  type SceneDoc,
} from '@three-studio/core';
import type { EntityMarker, EntityOverlay } from '../../components/registry';

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
 * Which entity gets which marker, as the registered overlays say.
 *
 * Made once, by whoever draws the markers, from the overlays a root registered:
 * the two lists below are sorted when it is made, so that asking about an
 * entity stays a handful of table lookups.
 */
export interface MarkerRules {
  /** The types worth marking, best first: where a full pass looks for candidates. */
  readonly markedTypes: readonly ComponentTypeId[];
  /** Whether the entity contributes no geometry of its own. */
  drawsNothing(scene: SceneDoc, entityId: EntityId): boolean;
  /**
   * The marker an entity should carry, or `undefined` when it needs none.
   *
   * An entity carrying nothing at all gets none. It used to get a grey one, and
   * the entity that showed why it was wrong is the `Scene` node every new scene
   * opens with: a marker there says "an entity is at the origin", which the
   * hierarchy already says better. Treating that node as a
   * special case is ruled out — it is "une entité ordinaire, ni protégée, ni spéciale" — so the
   * rule has to hold for every bare entity, and it does: a group is scaffolding,
   * and what hangs under it is what an author clicks.
   *
   * Every lookup is against a component table, never a walk of the entity
   * table.
   */
  markerStyleFor(scene: SceneDoc, entityId: EntityId): MarkerStyle | undefined;
}

export function markerRules(overlays: Registry<ComponentTypeId, EntityOverlay>): MarkerRules {
  /*
   * The types that draw geometry of their own, so the check stays three lookups
   * and not one per type. An entity carrying one is already clickable, and a
   * marker on top of it would be an icon nobody needs and a click target
   * fighting the mesh behind it. Every type answers, in its own overlay — a
   * type left out of a list drew geometry *and* got a marker on top of it, with
   * nothing anywhere to say that was meant.
   */
  const renders = overlays
    .values()
    .filter((overlay) => overlay.drawsGeometry)
    .map((overlay) => overlay.id);
  /*
   * The types worth marking, best first. The rank is a number on the marker,
   * declared with the type's overlay. Still a separate decision from the
   * Hierarchy's icons, and for the reason `EntityMarker` gives: the order is
   * about *this* display, not about the types.
   */
  const ranked = overlays
    .values()
    .flatMap(({ id, marker }) => (marker === null ? [] : [{ id, marker }]))
    .sort((a, b) => a.marker.priority - b.marker.priority);

  const drawsNothing = (scene: SceneDoc, entityId: EntityId): boolean =>
    !renders.some((type) => hasComponent(scene, entityId, type));

  return {
    markedTypes: ranked.map(({ id }) => id),
    drawsNothing,
    markerStyleFor: (scene, entityId) => {
      if (!scene.entities.has(entityId)) return undefined;
      if (!drawsNothing(scene, entityId)) return undefined;
      return ranked.find(({ id }) => hasComponent(scene, entityId, id))?.marker;
    },
  };
}
