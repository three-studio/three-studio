import type { ComponentDoc, ComponentOfType, ComponentType } from '../scene/schema';

/*
 * One module per component type, registered once.
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
 * `runtime` below was for, and the audio chantier closed the gap that column
 * had been pointing at since it was added.
 *
 * This follows a pattern the repo already had and applied in exactly one place:
 * `registerBehaviour(type, factory)` in `packages/runtime/src/behaviour`.
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
  | 'move'
  | 'shapes'
  | 'sparkles'
  | 'volume'
  | 'waves'
  | 'weight';

export interface ComponentDefinition<T extends ComponentType = ComponentType> {
  readonly type: T;
  /** A blank one, for "Add Component" and for filling a stored one's gaps. */
  create: () => ComponentOfType<T>;
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
   */
  fill?: (stored: ComponentOfType<T>) => ComponentOfType<T>;
  /** Asset ids this component points at. Empty for most types. */
  assets: (component: ComponentOfType<T>) => readonly (string | null)[];
  readonly icon: ComponentIcon;
  /**
   * Whether anything builds this type at runtime.
   *
   * `false` means the component can be added and edited and will do nothing.
   * The pair that made this flag necessary — `audioSource` and `audioListener`
   * — turned `true` with the audio chantier, and **nothing is `false` today**.
   * That is the outcome the flag was for, not its retirement: the value is that
   * the next authorable-but-inert type is a value someone can assert on rather
   * than a discovery.
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
  placeable: (component: ComponentOfType<T>) => boolean;
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

const definitions = new Map<ComponentType, ComponentDefinition>();

/**
 * Declares a component type.
 *
 * Registration happens as a side effect of importing the module, which has one
 * failure mode worth knowing: a module nobody imports registers nothing, and the
 * type simply goes missing with no error. `components/index.ts` imports all of
 * them and a test counts them.
 */
export function defineComponent<T extends ComponentType>(
  definition: ComponentDefinition<T>,
): ComponentDefinition<T> {
  definitions.set(definition.type, definition as unknown as ComponentDefinition);
  return definition;
}

/** The definition for a type, or `undefined` for one this build never heard of. */
export function componentDefinition<T extends ComponentType>(
  type: T,
): ComponentDefinition<T> | undefined {
  return definitions.get(type) as ComponentDefinition<T> | undefined;
}

/** Every registered definition, in registration order. */
export function componentDefinitions(): readonly ComponentDefinition[] {
  return [...definitions.values()];
}

/**
 * Types that can be authored but that nothing builds when the game runs.
 *
 * Not a list kept by hand — derived, so it cannot drift. A type that gains a
 * system leaves it by changing one flag in one file.
 */
export function typesWithoutRuntime(): readonly ComponentType[] {
  return componentDefinitions()
    .filter((definition) => !definition.runtime)
    .map((definition) => definition.type);
}

/**
 * Types a user can attach by hand, in registration order.
 *
 * Derived for the same reason `typesWithoutRuntime` is: a new type answers the
 * question in its own module, where the compiler insists on an answer, rather
 * than in a list somewhere else that nothing checks.
 */
export function addableTypes(): readonly ComponentType[] {
  return componentDefinitions()
    .filter((definition) => definition.addable)
    .map((definition) => definition.type);
}

/** Asset ids a component points at, whatever its type. */
export function componentAssets(component: ComponentDoc): readonly (string | null)[] {
  const definition = componentDefinition(component.type);
  // A type from a plugin, or from a later version of the editor. It names assets
  // this build cannot see, and guessing would be worse than saying none.
  return definition ? definition.assets(component as never) : [];
}

/**
 * Whether a component's position in the world means anything.
 *
 * An unknown type — a plugin's, or a newer editor's — is placed. It is the
 * answer eleven of the twelve types here give, and a position that turns out
 * to mean nothing is cosmetic where dropping a new object at the world origin,
 * out of sight of the author who just added it, is not.
 */
export function componentIsPlaceable(component: ComponentDoc): boolean {
  const definition = componentDefinition(component.type);
  return definition ? definition.placeable(component as never) : true;
}

/**
 * A stored component with everything added since it was written filled in.
 *
 * An unknown type comes back **exactly as found**. Filling it against a type we
 * do not have would invent a shape, and the next save would write that invention
 * over the author's data. A field is deprecated, never lost.
 *
 * A type that declared no `fill` gets the default: its own factory underneath
 * what was stored, so nothing the author wrote is overwritten and nothing added
 * since is left `undefined`. See `ComponentDefinition.fill` for the three that
 * need more than that.
 */
export function fillComponent(stored: ComponentDoc): ComponentDoc {
  const definition = componentDefinition(stored.type);
  if (!definition) return stored;
  if (definition.fill) return definition.fill(stored as never);
  return { ...definition.create(), ...stored };
}
