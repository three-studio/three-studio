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
  | 'volume'
  | 'waves'
  | 'weight';

export interface ComponentDefinition<T extends ComponentType = ComponentType> {
  readonly type: T;
  /** A blank one, for "Add Component" and for filling a stored one's gaps. */
  create: () => ComponentOfType<T>;
  /**
   * A stored component with everything it lacks filled in.
   *
   * Per type rather than one general rule, because the general rule only works
   * for the flat ones: `mesh` owns a material and a geometry that have to be
   * merged a level deeper, and a shallow spread would leave a scene written
   * before texture slots existed with `undefined` where three expects a value.
   */
  fill: (stored: ComponentOfType<T>) => ComponentOfType<T>;
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

/** Asset ids a component points at, whatever its type. */
export function componentAssets(component: ComponentDoc): readonly (string | null)[] {
  const definition = componentDefinition(component.type);
  // A type from a plugin, or from a later version of the editor. It names assets
  // this build cannot see, and guessing would be worse than saying none.
  return definition ? definition.assets(component as never) : [];
}

/**
 * A stored component with everything added since it was written filled in.
 *
 * An unknown type comes back **exactly as found**. Filling it against a type we
 * do not have would invent a shape, and the next save would write that invention
 * over the author's data. A field is deprecated, never lost.
 */
export function fillComponent(stored: ComponentDoc): ComponentDoc {
  const definition = componentDefinition(stored.type);
  return definition ? definition.fill(stored as never) : stored;
}
