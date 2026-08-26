import type { ComponentDoc, ComponentOfType, ComponentType } from '@three-studio/core';
import type { Object3D } from 'three/webgpu';

/*
 * One helper per component type that has a shape worth showing.
 *
 * The editor-side counterpart of `ComponentSystem`, and shaped after it on
 * purpose — but it is a much smaller contract, because a helper owns nothing the
 * document can edit. There is no `patch`: three's helpers are all built to be
 * re-read from their source, so an intensity change or a new `fov` is followed
 * by calling `update()` rather than by rebuilding anything.
 */

/** What a helper built. Detached and freed by `SelectionHelpers`. */
export interface HelperHandle {
  /** What this helper contributes to the annotation group. */
  readonly objects: readonly Object3D[];
  /**
   * Re-reads the source. Called every frame while mounted.
   *
   * The component is handed in because not every annotation has a three object
   * to read from. A light's helper takes `light.matrixWorld` by reference and
   * ignores this; an audio source builds no object at all, so the document is
   * the only place its radius and its cone exist. Optional in practice —
   * everything that wraps one of three's helpers drops it.
   */
  update(component: ComponentDoc): void;
  dispose(): void;
}

/**
 * Draws an annotation for one component while its entity is selected.
 *
 * `mount` is declared as a **method** rather than a property holding a function,
 * and that is what keeps this file free of casts: TypeScript leaves method
 * parameters bivariant even under `strictFunctionTypes`, so a
 * `ComponentHelper<'light'>` goes into a `readonly ComponentHelper[]` as it is.
 * `Reconciler` needed its `erase()` because a system also has `patch` and
 * `unmount` to reconcile; the guarantee here is the same one and it is the
 * table's key — a helper is only ever handed a component of the type it is filed
 * under.
 */
export interface ComponentHelper<T extends ComponentType = ComponentType> {
  readonly type: T;

  /**
   * @param source The object the runtime system built for this component. A
   *   light of a different `kind` is a different class, so the identity of this
   *   object is what says the annotation has to be rebuilt — the editor-side
   *   echo of the systems' `patch` / `'remount'` contract.
   * @returns `null` when there is nothing to draw. An ambient light has no
   *   position and no direction; a marker already says where its entity is.
   */
  mount(component: ComponentOfType<T>, source: Object3D): HelperHandle | null;
}

/**
 * Wraps one of three's helpers, which all share this shape: an `Object3D` with
 * an `update()` that re-reads its source and a `dispose()` that frees its lines.
 *
 * Written once here because every helper in this folder would otherwise repeat
 * it, and because the two lines that make an annotation behave — never picked,
 * always drawn on top of what it annotates — are exactly the two a new helper
 * would forget.
 */
/**
 * @param after Runs after each `update()`, for a helper whose own defaults do
 *   not suit an editor — `SpotLightHelper` sizes its cone at a thousand units
 *   when the light's range is unbounded. After, never instead: `update()` is
 *   what orients the cone and what colours it.
 */
export function annotation(
  // `update` is optional because three's helpers are not uniform, whatever the
  // family resemblance: `RectAreaLightHelper` has none, and re-reads its light
  // from an overridden `updateMatrixWorld` that the render traversal calls on
  // its own. Requiring the method meant either a cast at the call site or a
  // no-op passed in to satisfy a signature — both of which hide that a helper
  // needing nothing from us is a legitimate answer.
  object: Object3D & { update?(component: ComponentDoc): void; dispose(): void },
  after?: () => void,
): HelperHandle {
  // The whole subtree, not just the root: three's helpers hang their lines off
  // children, and `Raycaster` and the render sort both work per object. Nothing
  // raycasts the annotation group today, so this is belt to the braces — but it
  // is the brace a new helper would forget, which is why it is written once.
  object.traverse((child) => {
    // An annotation is read-only: clicking a frustum line must select whatever
    // is behind it, not swallow the click.
    child.raycast = () => undefined;
    // Under the markers and the outline, above the scene.
    child.renderOrder = 997;
  });

  return {
    objects: [object],
    update: (component) => {
      // Forwarded, and ignored by everything that wraps one of three's helpers:
      // their `update()` takes no arguments, which is assignable to this and
      // simply drops it.
      object.update?.(component);
      after?.();
    },
    dispose: () => {
      object.dispose();
    },
  };
}
