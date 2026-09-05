import { COMPONENT_TYPES, hasComponent, type ComponentType, type SceneDoc } from '@three-studio/core';
import {
  drawsGeometry as audioListenerDrawsGeometry,
  marker as audioListenerMarker,
} from '../../components/audioListener/overlay';
import {
  drawsGeometry as playerControllerDrawsGeometry,
  marker as playerControllerMarker,
} from '../../components/playerController/overlay';
import {
  drawsGeometry as rigidbodyDrawsGeometry,
  marker as rigidbodyMarker,
} from '../../components/rigidbody/overlay';
import {
  drawsGeometry as colliderDrawsGeometry,
  marker as colliderMarker,
} from '../../components/collider/overlay';
import { drawsGeometry as lightDrawsGeometry, marker as lightMarker } from '../../components/light/overlay';
import {
  drawsGeometry as scriptDrawsGeometry,
  marker as scriptMarker,
} from '../../components/script/overlay';
import {
  drawsGeometry as prefabInstanceDrawsGeometry,
  marker as prefabInstanceMarker,
} from '../../components/prefabInstance/overlay';
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
  light: lightDrawsGeometry,
  camera: false,
  rigidbody: rigidbodyDrawsGeometry,
  collider: colliderDrawsGeometry,
  audioSource: false,
  audioListener: audioListenerDrawsGeometry,
  script: scriptDrawsGeometry,
  prefabInstance: prefabInstanceDrawsGeometry,
  playerController: playerControllerDrawsGeometry,
};

/** The types that do, so the check below stays three lookups and not twelve. */
const RENDERS: readonly ComponentType[] = (Object.keys(RENDERABLE) as ComponentType[]).filter(
  (type) => RENDERABLE[type],
);

/**
 * The marker each type contributes, `null` for none.
 *
 * The ranking used to be the key order of this table. It is a number on the
 * marker now, because a type declares its marker in its own folder and a folder
 * has no place in anyone's key order — and the ranking still has to be
 * expressible: the first styled type an entity carries is the one that colours
 * it. A separate decision from `HierarchyPanel`'s `ICON_PRIORITY`, and for the
 * reason that file already gives: the order is about *this* display, not about
 * the types. A camera outranks a light here because a camera rig is what an
 * author is looking for when both sit on one entity.
 *
 * `null` is a decision — "this type is never worth a marker" — where an absent
 * key was only ever an omission nobody could tell from a choice.
 */
const STYLES: Record<ComponentType, EntityMarker | null> = {
  camera: { color: 0x5eb0ff, pixels: 11, priority: 1 },
  light: lightMarker,
  audioSource: { color: 0x6ee7a8, pixels: 9, priority: 3 },
  audioListener: audioListenerMarker,
  mesh: null,
  model: null,
  water: null,
  rigidbody: rigidbodyMarker,
  collider: colliderMarker,
  script: scriptMarker,
  prefabInstance: prefabInstanceMarker,
  playerController: playerControllerMarker,
};

/**
 * The styled types, best first.
 *
 * Derived rather than repeated: the list this replaced was a second copy of the
 * same four names, and a fifth style would have had to be added to both.
 */
const PRIORITY: readonly ComponentType[] = COMPONENT_TYPES.filter(
  (type) => STYLES[type] !== null,
).sort((a, b) => STYLES[a]!.priority - STYLES[b]!.priority);

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
