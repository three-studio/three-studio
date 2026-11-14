import { isRecord } from '../conform';
import { shown, type DecodePath, type Decoded, type Diagnostic } from '../decoded';
import { planFields, type Infer, type Schema } from '../fieldSchema';
import { createComponentId, isComponentId, type AssetId, type EntityId } from '../ids';
import type { Component } from '../scene/primitives';
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
  /** A blank one, for "Add Component" and for filling a stored one's gaps. */
  create(): C;
  /**
   * The type's fields, for a type written as a schema: what its pane is derived
   * from. A type still written by hand has none, and a pane written by hand.
   */
  readonly schema?: Schema;
  /**
   * A stored component, checked field by field against the schema, for a type
   * written as one. A scene holding a component it refuses does not open, and
   * says which field of which component. A type still written by hand is read
   * through `fill` and checked nowhere.
   */
  decode?(value: unknown, path: DecodePath): Decoded<C>;
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
 * one field by field, and the assets it names are its asset fields. The type's
 * TypeScript type is `Component<Id, Infer<typeof schema>>`, which the type's
 * own file adds to `ComponentTypes`.
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
  readonly schema: S;
  readonly runtime: boolean;
  readonly addable: boolean;
  /** Left out, a component of the type is a place in the world, which all but two kinds of light are. */
  readonly placeable?: (component: Component<Id, Infer<S>>) => boolean;
}): ComponentDefinition<Component<Id, Infer<S>>> {
  const { id: type, label, schema, runtime, addable } = description;
  const plan = planFields(schema);

  return {
    id: type,
    label,
    schema,
    runtime,
    addable,
    // A copy of the defaults each time: a vector is an array, and two
    // components sharing one would be edited together.
    create: () => ({ ...structuredClone(plan.defaults), id: createComponentId(), type }),
    decode: (value, path) => {
      if (!isRecord(value)) {
        return { ok: false, diagnostics: [{ code: 'field.invalid', message: `expected a component, found ${shown(value)}`, path }] };
      }
      // What every component carries is checked here, and the rest is the
      // schema's: `id` and `type` are no fields of it.
      const { id, type: storedType, ...fields } = value;
      const decoded = plan.decode(fields, path);
      if (isComponentId(id) && storedType === type && decoded.ok) {
        return { ok: true, value: { ...decoded.value, id, type } };
      }
      const diagnostics: Diagnostic[] = [];
      if (!isComponentId(id)) {
        diagnostics.push({ code: 'field.invalid', message: `expected a component id, found ${shown(id)}`, path: [...path, 'id'] });
      }
      if (storedType !== type) {
        diagnostics.push({ code: 'field.invalid', message: `expected ${shown(type)}, found ${shown(storedType)}`, path: [...path, 'type'] });
      }
      if (!decoded.ok) diagnostics.push(...decoded.diagnostics);
      return { ok: false, diagnostics };
    },
    assets: (component) => plan.assets(component),
    entities: () => [],
    placeable: description.placeable ?? (() => true),
  };
}
