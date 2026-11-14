import type { AssetId, EntityId } from '../ids';
import type { ComponentDoc } from '../scene/schema';

/*
 * One module per component type, each a definition the core's activation
 * registers.
 *
 * Adding a type cost eight files, and eight chances to forget one. For `light`:
 * the schema, the factory, the migration, the three build, the inspector schema,
 * `buildInspector`, the hierarchy icon, the viewport. Measured before writing
 * this: `script` is named in twelve source files, `collider` in nine.
 *
 * The proof that it was needed was `audioSource`: in the schema, in the
 * defaults, in the inspector and in reference extraction — and nowhere at all
 * at runtime. The component was editable and did nothing, and eight separate
 * files could not show that. A table with a column for it could, which is what
 * `runtime` below was for, and the runtime's sound closed the gap that column
 * had been pointing at since it was added.
 *
 * This follows a pattern the repo already had and applied in exactly one place:
 * a behaviour per type in `packages/runtime/src/behaviour`.
 *
 * **It describes a type; it does not live in the data.** `EntityDoc` stays plain
 * JSON, which is what makes the play-mode snapshot, the save and the web export
 * work.
 */

/** Icon names, resolved to components by whoever draws them. */
export type ComponentIcon =
  | 'box'
  | 'boxes'
  | 'camera'
  | 'file-code'
  | 'lightbulb'
  | 'link'
  | 'move'
  | 'shapes'
  | 'sparkles'
  | 'volume'
  | 'waves'
  | 'weight';

/**
 * What a component type answers about itself: what the core's activation
 * registers.
 *
 * Its functions are methods, and that is what lets one registry hold all
 * fourteen: TypeScript compares a method's parameters both ways, so a
 * `ComponentDefinition<MeshComponent>` is a `ComponentDefinition` with no cast.
 * Sound because a registry files a definition under its own `id`, and a
 * component is only ever handed to the definition of its own `type`. Written as
 * arrow-typed properties instead, they would be compared one way only, and no
 * definition would register: the build would say so.
 *
 * Parameterised by the component rather than by its type's name: through
 * `ComponentOfType<'mesh'>`, a conditional type, TypeScript can no longer tell
 * which way the parameter varies, and holds it fixed.
 */
export interface ComponentDefinition<C extends ComponentDoc = ComponentDoc> {
  readonly id: C['type'];
  /** A blank one, for "Add Component" and for filling a stored one's gaps. */
  create(): C;
  /**
   * A stored component with everything it lacks filled in — declared **only by
   * the types the default is wrong for**.
   *
   * The default is `{ ...create(), ...stored }`, and it was written out nine
   * times identically before it was written once. Leaving it out is not a hole
   * in the definition: the default asks for nothing this table does not
   * already hold, since it fills from the type's own `create()`. That is also
   * what keeps it inside the persisted-format rule — a missing field is filled
   * from the factory for its type, never from a second list.
   *
   * What the default cannot do is reach a level deeper, and a **nested object**
   * is exactly what the three overrides have: `mesh` (its material and its
   * geometry), `water` (its geometry), `light` (its shadow settings, and a
   * `kind` that decides which defaults to merge against at all). A scene
   * written before a sub-object gained a field comes back with `undefined`
   * inside it otherwise — the bug that shipped twice on this project. Each of
   * the three says so in its own module.
   *
   * The collider and the rigid body declare one for another reason, which their
   * modules give: physics data is read against its factory, and what it does
   * not know is dropped.
   */
  fill?(stored: C): C;
  /**
   * Asset ids this component points at. Empty for most types. `''` and `null`
   * are the slots that name none, which the four that say it with `''` hand
   * over as they hold it.
   */
  assets(component: C): readonly (AssetId | '' | null)[];
  /**
   * Entity ids this component points at — a joint its Connected Body. Empty
   * for most types. Asked of every type, as `assets` is, so that a new type
   * answers in its own module. `''` and `null` are the slots that name none, as
   * they are for `assets`.
   */
  entities(component: C): readonly (EntityId | '' | null)[];
  /**
   * Strings that may name an asset, and count only when they do — declared by
   * the types whose fields do not say which they are.
   *
   * A script's properties are its own to declare, in code only the player
   * runs: a string there may be an asset picked in the inspector, an entity's
   * id or a line of dialogue, and nothing outside the script can tell. Kept
   * where a project asset answers to it, which an id made by `createId` does
   * and a sentence does not. Without it, the texture a script was handed in the
   * inspector shipped in no build that did not ship the whole project.
   */
  assetCandidates?(component: C): readonly string[];
  readonly icon: ComponentIcon;
  /**
   * Whether anything builds this type at runtime.
   *
   * `false` means the component can be added and edited and will do nothing.
   * The pair that made this flag necessary — `audioSource` and `audioListener`
   * — turned `true` once the runtime played sound, and **nothing is `false`
   * today**. That is the outcome the flag was for, not its retirement: the value
   * is that the next authorable-but-inert type is a value someone can assert on
   * rather than a discovery.
   */
  readonly runtime: boolean;
  /**
   * Whether this component's position in the world means anything.
   *
   * A function of the component and not a flag on the type, because the one
   * type that answers `no` answers it by its `kind`: three applies an ambient
   * and a hemisphere light to the whole scene wherever the object stands.
   * Placing one where the author is looking puts a number in the inspector
   * that does nothing, which reads as a bug the first time somebody drags it
   * and the scene does not change.
   *
   * Asked of every type rather than assumed, for the reason `runtime` and
   * `addable` are asked: a new type answers in its own module, where the
   * compiler insists, rather than in a table somewhere else that nothing
   * checks. Eleven of the twelve answer `() => true`, the same way seven of
   * them answer `assets: () => []`.
   */
  placeable(component: C): boolean;
  /**
   * Whether a user can attach one by hand, from "Add Component".
   *
   * `false` is for the types that arrive with something else and would mean
   * nothing alone: `model` comes from dropping a file, `prefabInstance` from
   * placing a prefab, and neither is anything without the asset id the drop
   * supplies. An empty one added from a menu would point at nothing.
   *
   * Here rather than in the editor because the menu was a hand-kept list of ten
   * types, and a list is a thing to forget: a new type left out of it is simply
   * unaddable, with no error anywhere and nothing on screen to say why.
   */
  readonly addable: boolean;
}

/**
 * Declares a component type: its argument, with `C` inferred from what its
 * `create` makes, and its `id` held to that component's own `type`.
 *
 * Each slice exports what this returns, and registers nothing by being
 * imported: the core's activation lists the kernel's definitions, in the order
 * the Add Component menu offers them.
 */
export function defineComponent<C extends ComponentDoc>(definition: ComponentDefinition<C>): ComponentDefinition<C> {
  return definition;
}
