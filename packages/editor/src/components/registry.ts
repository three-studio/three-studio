/*
 * The vocabulary an editor-side slice is written in.
 *
 * A component type costs three folders — one per package — and this is the
 * editor's. What a type declares here is what the five shared displays used to
 * name it in: the inspector pane, the viewport marker, the selection
 * annotation, and the Add menu.
 *
 * Below the slices and below the index that assembles them, for the reason
 * `inspector/fields.ts` is: a slice is written in this vocabulary and the index
 * imports the slices, so sharing a module would make every slice a cycle.
 */
import type { ComponentTypeId, EntityTemplate } from '@three-studio/core';
import type { LucideIcon } from 'lucide-react';
import type { ComponentHelper } from '../viewport/overlay/ComponentHelper';

/**
 * The dot an entity gets in the viewport when it draws nothing of its own, and
 * where it ranks when the entity carries several types that want one.
 *
 * Lowest priority wins. It is a decision about *this* display and not about the
 * types — a camera outranks a light because a camera rig is what an author is
 * looking for when both sit on one entity — which is why it is not the
 * hierarchy's `HierarchyIcon.priority` and must not be made to be. Those are
 * two displays and they stay two decisions.
 */
export interface EntityMarker {
  readonly color: number;
  /** Radius the marker aims for on screen, in pixels. */
  readonly pixels: number;
  readonly priority: number;
}

/**
 * What one type contributes to the Add menu.
 *
 * A submenu rather than a flat entry because the primitives alone run off the
 * bottom of a short window, and because two types can name the same one: an
 * audio source and an audio listener both sit under "Audio", and the group is
 * shared by naming it rather than by anyone listing them together.
 */
export interface AddMenuGroup {
  /** The type that offers it, which is what it is registered under. */
  readonly id: ComponentTypeId;
  readonly label: string;
  /** Where the submenu sits among the others. Lowest first. */
  readonly order: number;
  readonly entries: readonly AddMenuEntry[];
}

/**
 * One thing "Add" can create. `null` draws a rule between two runs of them.
 *
 * What to create, never how to place it: a slice says a cube is on offer, and
 * `shell/addMenu.ts` is what turns that into an `onSelect` calling
 * `addEntityInView`. The split is not tidiness — it is what keeps the viewport
 * off the command side, since the same declarations are read by the overlay,
 * and `state/projectStore` still reaches into the viewport.
 */
export type AddMenuEntry = { readonly label: string; readonly create: () => EntityTemplate } | null;

/**
 * What one type contributes to the viewport: whether it is worth clicking, the
 * dot it gets when it is not, and the annotation it draws while selected.
 *
 * Every type answers all three. A `null` here is a decision, where being absent
 * from a list was only ever an omission nobody could tell from a choice.
 */
export interface EntityOverlay {
  readonly id: ComponentTypeId;
  readonly drawsGeometry: boolean;
  readonly marker: EntityMarker | null;
  /**
   * Makes the annotation's helper, for the viewport that will mount it. A
   * function and not the helper: one made where it is declared would be made
   * when the file is imported, and shared by every viewport and every test.
   */
  readonly helper: (() => ComponentHelper) | null;
}

/**
 * The icon a type gives its entity's row in the Hierarchy, and where it ranks
 * when the entity carries several types that have one. Lowest priority wins.
 *
 * The icon itself and not a name for it, so that a type defined outside this
 * package brings its own. A type that registers none does not decide a row: a
 * mesh, a model or a bare entity draws the plain box.
 *
 * The rank is a decision about this tree, not about the types — a prefab
 * instance is what the row *is*, whatever else got added to it.
 */
export interface HierarchyIcon {
  readonly id: ComponentTypeId;
  readonly icon: LucideIcon;
  readonly priority: number;
}
