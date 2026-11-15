import { isRecord } from '../conform';
import { invalid, shown, type DecodePath, type Decoded, type Diagnostic } from '../decoded';
import { planFields, type Infer, type Schema } from '../fieldSchema';
import { createComponentId, isComponentId, type AssetId, type EntityId } from '../ids';
import type { Component } from '../scene/primitives';
import type { ComponentDoc, ComponentTypeId, ComponentTypes, SceneDoc } from '../scene/schema';

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

/**
 * A type another cannot work without, and how it is brought: Unity's
 * RequireComponent. One per required type, so that the component its `create`
 * makes is typed as that type's.
 */
export type Requirement = { readonly [K in keyof ComponentTypes]: RequirementOf<K> }[keyof ComponentTypes];

export interface RequirementOf<K extends keyof ComponentTypes> {
  readonly type: K;
  /**
   * Whether the entity has it without holding one itself — a body's
   * colliders on its children, a joint's body up the tree. Asked of the
   * expanded scene, where what a prefab placed under it holds counts.
   */
  readonly metElsewhere?: (scene: SceneDoc, entityId: EntityId) => boolean;
  /** The one brought, where the required type's own `createFor` is not what this type needs. */
  readonly create?: (siblings: readonly ComponentDoc[]) => ComponentTypes[K];
}

/**
 * What a component type answers about itself: what the core's activation
 * registers. Made by `defineComponent` alone, from the type's schema, so that
 * no answer here is written by hand beside the fields it is about.
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
 *
 * Bounded by the shape every component has and not by `ComponentDoc`: a type
 * written as a schema is typed from that schema, and nothing can show, for any
 * schema, that the result is one of `ComponentDoc`'s members. The registry asks
 * it instead, where the definition is registered: one whose type is in no
 * `ComponentTypes` is not a `ComponentDefinition` there, and does not compile.
 */
export interface ComponentDefinition<C extends Component<string, object> = ComponentDoc> {
  readonly id: C['type'];
  /** What the type is called wherever the editor names it: a pane's heading, the Add Component menu, a message. */
  readonly label: string;
  /**
   * The version of the type's fields, for a type written as a schema: moved
   * whenever they change, so that data written with other fields is refused
   * by name rather than read as if it were this type's.
   */
  readonly version: number;
  /** A blank one, for "Add Component": the schema's defaults under a new id. */
  create(): C;
  /**
   * A new one for an entity holding `siblings`, shaped from them where the
   * type can guess better than its defaults: a collider added to a capsule
   * comes out as a capsule. `create()` for a type that cannot.
   */
  createFor(siblings: readonly ComponentDoc[]): C;
  /**
   * The types it cannot work without, brought along when it is added: each
   * one the entity neither holds nor has elsewhere, and in turn what that one
   * requires. A player controller with no collider flies, and a body with no
   * collider falls through the world: both easy to build, and hard to explain
   * from what the screen shows.
   */
  readonly requires: readonly Requirement[];
  /**
   * The types it cannot sit beside, read both ways, so that a pair is written
   * by one of the two.
   */
  readonly excludes: readonly ComponentTypeId[];
  /** Whether an entity may hold several: a body's colliders, an entity's scripts. Else one at most. */
  readonly multiple: boolean;
  /**
   * Whether this component goes with the drawing when its entity's drawing
   * passes to other entities — Unpack Model's pieces — a copy to each piece
   * that draws, rather than staying with the entity. A fact about the
   * component, not a list of the operation's, so that the operation names no
   * type it moves.
   */
  followsDrawing(component: C): boolean;
  /** The type's fields: what its type, its decoder, its references and its pane are derived from. */
  readonly schema: Schema;
  /**
   * A stored component, checked field by field against the schema. A scene
   * holding a component it refuses does not open, and says which field of
   * which component.
   */
  decode(value: unknown, path: DecodePath): Decoded<C>;
  /** The asset ids this component names, one per asset field: an id, or `null` for an empty slot. */
  assets(component: C): readonly (AssetId | null)[];
  /** The entity ids this component names — a joint its Connected Body — one per entity field. */
  entities(component: C): readonly (EntityId | null)[];
  /**
   * Strings that may name an asset or an entity, and count only where one
   * answers to them: what a script's properties and a prefab's overrides hold,
   * whose meaning only their owner knows.
   */
  candidates(component: C): readonly string[];
  /**
   * The component with each entity it names replaced by `rename`'s answer,
   * where there is one: what a copy needs, for the references inside the copied
   * set to name the copies. The component itself when its type names none.
   */
  renameEntities(component: C, rename: (id: EntityId) => EntityId | undefined): C;
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
 * Declares a component type from its fields.
 *
 * Everything the definition answers about the data comes from the schema: the
 * blank component is its defaults under a new id, the decoder checks a stored
 * one field by field, and the assets and entities it names are its asset and
 * entity fields. The type's TypeScript type is `Component<Id, Infer<typeof
 * schema>>`, which the type's own file adds to `ComponentTypes`.
 *
 * The plan is computed here, once, so a schema that contradicts itself fails
 * where the type is defined, the first time anything imports it.
 *
 * What it returns is exported and registers nothing: an activation lists it.
 */
export function defineComponent<const Id extends string, const S extends Schema>(description: {
  /**
   * The type's id, which is also what each of its components holds as `type`.
   * Typed as both: a schema that declared a field named `type` would give that
   * key two meanings, and no id satisfies the two at once, so it does not
   * compile.
   */
  readonly id: Id & Component<Id, Infer<S>>['type'];
  readonly label: string;
  /** See `ComponentDefinition.version`. A type starts at 1. */
  readonly version: number;
  readonly schema: S;
  readonly runtime: boolean;
  readonly addable: boolean;
  /** Left out, a component of the type is a place in the world, which all but two kinds of light are. */
  readonly placeable?: (component: Component<Id, Infer<S>>) => boolean;
  /** Left out, a new one is the type's defaults, whatever the entity holds. */
  readonly createFor?: (siblings: readonly ComponentDoc[]) => Component<Id, Infer<S>>;
  /** Left out, it requires nothing. */
  readonly requires?: readonly Requirement[];
  /** Left out, it excludes nothing. */
  readonly excludes?: readonly ComponentTypeId[];
  /** Left out, an entity holds one at most. */
  readonly multiple?: boolean;
  /** Left out, a component of the type stays with its entity. */
  readonly followsDrawing?: (component: Component<Id, Infer<S>>) => boolean;
}): ComponentDefinition<Component<Id, Infer<S>>> {
  const { id: type, label, version, schema, runtime, addable } = description;
  const plan = planFields(schema);
  // A copy of the defaults each time: a vector is an array, and two
  // components sharing one would be edited together.
  const create = (): Component<Id, Infer<S>> => ({ ...structuredClone(plan.defaults), id: createComponentId(), type });

  return {
    id: type,
    label,
    version,
    schema,
    runtime,
    addable,
    create,
    createFor: description.createFor ?? create,
    requires: description.requires ?? [],
    excludes: description.excludes ?? [],
    multiple: description.multiple ?? false,
    followsDrawing: description.followsDrawing ?? (() => false),
    decode: (value, path) => {
      if (!isRecord(value)) return { ok: false, diagnostics: [invalid(path, 'a component', value)] };
      // What every component carries is checked here, and the rest is the
      // schema's: `id` and `type` are no fields of it.
      const { id, type: storedType, ...fields } = value;
      const decoded = plan.decode(fields, path);
      if (isComponentId(id) && storedType === type && decoded.ok) {
        return { ok: true, value: { ...decoded.value, id, type } };
      }
      const diagnostics: Diagnostic[] = [];
      if (!isComponentId(id)) diagnostics.push(invalid([...path, 'id'], 'a component id', id));
      if (storedType !== type) diagnostics.push(invalid([...path, 'type'], shown(type), storedType));
      if (!decoded.ok) diagnostics.push(...decoded.diagnostics);
      return { ok: false, diagnostics };
    },
    assets: (component) => plan.assets(component),
    entities: (component) => plan.entities(component),
    candidates: (component) => plan.candidates(component),
    renameEntities: (component, rename) => {
      const renamed = plan.renameEntities(component, rename);
      return renamed === component ? component : { ...renamed, id: component.id, type };
    },
    placeable: description.placeable ?? (() => true),
  };
}
