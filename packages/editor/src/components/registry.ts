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
import type { EntityTemplate } from '@three-studio/core';
import type { ComponentHelper } from '../viewport/overlay/ComponentHelper';

/**
 * The dot an entity gets in the viewport when it draws nothing of its own, and
 * where it ranks when the entity carries several types that want one.
 *
 * Lowest priority wins. It is a decision about *this* display and not about the
 * types — a camera outranks a light because a camera rig is what an author is
 * looking for when both sit on one entity — which is why it is not the
 * hierarchy's `ICON_PRIORITY` and must not be made to be. Those are two
 * displays and they stay two decisions.
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
 * and `state/projectStore` still reaches into the viewport (lot 4).
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
  readonly drawsGeometry: boolean;
  readonly marker: EntityMarker | null;
  readonly helper: ComponentHelper | null;
}
