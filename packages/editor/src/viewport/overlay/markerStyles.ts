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
 * Types that draw something of their own. An entity carrying one is already
 * clickable, so a marker on top of it would be an icon nobody needs and a click
 * target fighting the mesh behind it.
 *
 * Total rather than the three that are true: a type left out of a list draws
 * geometry *and* gets a marker on top of it, and nothing says whether that was
 * meant. The compiler now asks.
 */
const RENDERABLE: Record<ComponentType, boolean> = {
  mesh: true,
  model: true,
  water: true,
  light: false,
  camera: false,
  rigidbody: false,
  collider: false,
  audioSource: false,
  audioListener: false,
  script: false,
  prefabInstance: false,
  playerController: false,
};

/** The types that do, so the check below stays three lookups and not twelve. */
const RENDERS: readonly ComponentType[] = (Object.keys(RENDERABLE) as ComponentType[]).filter(
  (type) => RENDERABLE[type],
);

/**
 * The marker each type contributes, `null` for none, **in priority order**.
 *
 * Two things at once, and the key order is the second of them: the first styled
 * type an entity carries is the one that colours it. A separate order from
 * `HierarchyPanel`'s `ICON_PRIORITY`, and for the reason that file already
 * gives: the order is a decision about *this* display, not about the types. A
 * camera outranks a light here because a camera rig is what an author is
 * looking for when both sit on one entity.
 *
 * `null` is a decision — "this type is never worth a marker" — where an absent
 * key was only ever an omission nobody could tell from a choice.
 */
const STYLES: Record<ComponentType, MarkerStyle | null> = {
  camera: { color: 0x5eb0ff, pixels: 11 },
  light: { color: 0xffd25e, pixels: 11 },
  audioSource: { color: 0x6ee7a8, pixels: 9 },
  audioListener: { color: 0x6ee7a8, pixels: 9 },
  mesh: null,
  model: null,
  water: null,
  rigidbody: null,
  collider: null,
  script: null,
  prefabInstance: null,
  playerController: null,
};

/**
 * The styled types, in the order `STYLES` lists them.
 *
 * Derived rather than repeated: the list this replaced was a second copy of the
 * same four names, and a fifth style would have had to be added to both.
 */
const PRIORITY: readonly ComponentType[] = (Object.keys(STYLES) as ComponentType[]).filter(
  (type) => STYLES[type] !== null,
);

/**
 * The types worth marking. Also what a full pass iterates, so it can go through
 * the component tables instead of the entity table — see `EntityMarkers.sync`.
 */
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
    const style = STYLES[type];
    if (style !== null && hasComponent(scene, entityId, type)) return style;
  }
  return undefined;
}
