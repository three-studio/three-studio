import { hasComponent, type ComponentType, type SceneDoc } from '@three-studio/core';

/*
 * Which entities get a marker in the viewport, and what it looks like.
 *
 * Pure, and deliberately so: "does this entity draw anything" is a question
 * about the document, and answering it here rather than inside `EntityMarkers`
 * is what lets a test ask it without a scene graph.
 */

export interface MarkerStyle {
  readonly color: number;
  /** Radius the marker aims for on screen, in pixels. */
  readonly pixels: number;
}

/**
 * Types that draw something. An entity carrying one of these is already
 * clickable, so a marker on top of it would be an icon nobody needs and a click
 * target fighting the mesh behind it.
 */
const RENDERABLE: readonly ComponentType[] = ['mesh', 'model', 'water'];

/**
 * Which component decides the colour when an entity carries several.
 *
 * A separate list from `HierarchyPanel`'s `ICON_PRIORITY`, and for the reason
 * that file already gives: the order is a decision about *this* display, not
 * about the types. A camera outranks a light here because a camera rig is what
 * an author is looking for when both sit on one entity.
 */
const PRIORITY: readonly ComponentType[] = ['camera', 'light', 'audioSource', 'audioListener'];

const STYLES: Partial<Record<ComponentType, MarkerStyle>> = {
  camera: { color: 0x5eb0ff, pixels: 11 },
  light: { color: 0xffd25e, pixels: 11 },
  audioSource: { color: 0x6ee7a8, pixels: 9 },
  audioListener: { color: 0x6ee7a8, pixels: 9 },
};

/**
 * The types worth marking. Also what a full pass iterates, so it can go through
 * the component tables instead of the entity table — see `EntityMarkers.sync`.
 */
export const MARKED_TYPES: readonly ComponentType[] = PRIORITY;

/** Whether the entity contributes no geometry of its own. */
export function drawsNothing(scene: SceneDoc, entityId: string): boolean {
  return !RENDERABLE.some((type) => hasComponent(scene, entityId, type));
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
    const style = STYLES[type];
    if (style && hasComponent(scene, entityId, type)) return style;
  }
  return undefined;
}
