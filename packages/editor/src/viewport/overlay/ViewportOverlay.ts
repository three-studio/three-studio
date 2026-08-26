import type { SceneDoc } from '@three-studio/core';
import type { SceneBinder } from '@three-studio/runtime';
import type { Group, PerspectiveCamera } from 'three/webgpu';
import { EntityMarkers } from './EntityMarkers';
import { SelectionHelpers } from './SelectionHelpers';

/**
 * Everything the viewport draws *about* the scene rather than *of* it.
 *
 * Two jobs, deliberately kept apart because they have neither the same lifetime
 * nor the same source:
 *
 * - `EntityMarkers` says **where** an entity that draws nothing is, permanently,
 *   gives a click something to land on, and carries the selection colour for
 *   anything the outline cannot draw a box around.
 * - `SelectionHelpers` says **what** a light or a camera covers, and only while
 *   it is selected.
 *
 * Called `overlay` rather than `gizmos` because `GizmoController` already means
 * `TransformControls` in this folder. The button an author sees still says
 * Gizmos, which is Unity's word for the same collection.
 */
export class ViewportOverlay {
  private readonly entityMarkers: EntityMarkers;
  private readonly selectionHelpers: SelectionHelpers;

  constructor(binder: SceneBinder) {
    this.entityMarkers = new EntityMarkers(binder);
    this.selectionHelpers = new SelectionHelpers(binder);
  }

  /**
   * Pickable: a click on a marker selects its entity.
   *
   * Handed to `Picker`, and the only part of this class that is. An annotation
   * must never take a click, so the two groups are separate rather than one
   * group the picker would have to filter.
   */
  get markers(): Group {
    return this.entityMarkers.root;
  }

  /** Never pickable: helpers are read-only annotations. */
  get annotations(): Group {
    return this.selectionHelpers.root;
  }

  /**
   * Re-derives which entities carry a marker.
   *
   * Structural, and driven from `syncDocument` with the same dirty set the
   * binder gets — not from the frame loop. Deciding it for a bare entity means
   * reading the entity table, which is exactly the per-frame scan ADR-16 set out
   * to remove.
   */
  sync(scene: SceneDoc, dirty: ReadonlySet<string> | undefined): void {
    this.entityMarkers.sync(scene, dirty);
  }

  /**
   * Call every frame.
   *
   * @param enabled The Gizmos toggle. Off hides both groups and does no work;
   *   what is already built stays built, because switching the overlay off to
   *   judge a lighting setup should not cost a rebuild when it comes back on.
   */
  update(
    scene: SceneDoc,
    selection: readonly string[],
    camera: PerspectiveCamera,
    viewportHeight: number,
    enabled: boolean,
  ): void {
    this.markers.visible = enabled;
    this.annotations.visible = enabled;
    if (!enabled) return;

    // Built once here rather than per marker: the selection is short, the marker
    // set is not, and both readers want membership rather than order.
    this.entityMarkers.update(camera, viewportHeight, new Set(selection));
    this.selectionHelpers.update(scene, selection);
  }

  dispose(): void {
    this.entityMarkers.dispose();
    this.selectionHelpers.dispose();
  }
}
