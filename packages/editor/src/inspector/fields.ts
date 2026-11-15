/*
 * The vocabulary a component pane is written in, below the panes themselves.
 *
 * These lived in `schema.ts` beside `COMPONENT_SCHEMAS` until a component type
 * moved into a folder of its own. That is what put them here: a slice is
 * written in this vocabulary, and the index that assembles the panes imports
 * the slices, so the two cannot share a module without every slice becoming an
 * import cycle — one the architecture test would name, and one that would be
 * twelve files wide by the end. The same split, for the same reason, as
 * `core`'s `scene/primitives.ts`.
 *
 * `schema.ts` re-exports all of it, so nothing that builds a pane has to know
 * this file exists.
 */
import {
  isComponentOfType,
  type AssetKind,
  type ComponentDoc,
  type ComponentId,
  type ComponentOfType,
  type ComponentType,
  type ComponentTypeId,
  type EntityId,
  type FieldDef,
} from '@three-studio/core';
import type { RuntimeRegistries } from '@three-studio/runtime';

/**
 * `Omit` that survives a union.
 *
 * The plain one collapses `A | B` to the keys they share, which for a field
 * would silently drop `min` from every row that has one. Needed here because
 * `FieldSpec` became a union the day the control was declared rather than
 * handed to Tweakpane as a bag of parameters.
 */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * What the control is, when the value alone cannot say it.
 *
 * Tweakpane reads the bound value and builds the obvious control for it — a
 * checkbox for a boolean, a colour picker for `#rrggbb`, a number field for a
 * number. A row says nothing until it has something to add: a range, a list of
 * choices, the fact that a tuple should be edited as a pad. So `type` is
 * absent on most rows, and where it is present it comes with the parameters
 * that only make sense for it.
 *
 * The variants are `core`'s, which is the whole point: an importer, a script
 * and a component pane say "a number between 0 and 1" in the same words, and
 * none of them names Tweakpane to do it.
 */
export type Declared = FieldDef | { type?: undefined };

/**
 * `A | B` intersected with the editor's own half, one member at a time.
 *
 * Written through a type parameter because that is the only way a conditional
 * type distributes: `(A | B) & X` left as an intersection makes `Omit` and
 * excess-property checking read the *shared* keys, which is a `FieldSpec` with
 * no `min` on it anywhere.
 */
type EachWith<D, E> = D extends unknown ? D & E : never;

/**
 * The one control this vocabulary does not describe.
 *
 * `assetField.ts` is a hand-written Tweakpane plugin — thumbnail, drop target,
 * import button — and it is claimed by these parameters rather than by a
 * declared variant. `FieldDef` does have an `asset` variant, but it means the
 * plain dropdown a script property gets today; the two are one idea with two
 * controls, and making them one is a change to what a designer sees rather
 * than to how a pane is written.
 */
export interface AssetSlotParams {
  view: 'asset';
  assetKind: AssetKind;
  /**
   * What the empty value is called, where "None" would be a lie.
   *
   * A mesh with no material asset draws its own embedded one; a model with none
   * draws the materials its file shipped with. Both are a *choice* rather than
   * an absence, and calling either "None" reads as "this object has no
   * material", which is the opposite of what is on screen.
   */
  emptyLabel?: string;
}

/**
 * Declarative description of one editable field.
 *
 * Adding a property to a component means adding a line here — the inspector,
 * its undo coalescing and its refresh loop are all generic over this table.
 *
 * @typeParam Subject What `path` is read from and what `visibleWhen` is handed:
 *   a component for the entity panes, the whole `SceneDoc` for the scene one.
 */
export type FieldSpec<Subject = ComponentDoc> = EachWith<Declared, FieldPlacement<Subject>>;

/** The half of a field only the editor can carry: where it lives, and closures. */
interface FieldPlacement<Subject> {
  /** Path inside the subject, e.g. `['material', 'roughness']`. */
  path: readonly string[];
  label: string;
  /** The asset slot, and nothing else; see `AssetSlotParams`. */
  params?: AssetSlotParams;
  /**
   * Options computed when the pane is built, for choices that depend on the
   * project — the scripts that exist, the entities in the scene, the textures
   * that have been imported. A declared `enum` covers the fixed case.
   */
  optionsProvider?: () => Record<string, string>;
  /** Shown only when this returns true; used for kind-specific light options. */
  visibleWhen?: (subject: Subject) => boolean;
  /** Document value -> value bound by Tweakpane. Overrides the variant's own. */
  toModel?: (value: unknown) => unknown;
  /** Value bound by Tweakpane -> document value. Overrides the variant's own. */
  fromModel?: (value: unknown) => unknown;
}

/** A field as the builder binds it, once `visibleWhen` has already been settled. */
export type BoundSpec = DistributiveOmit<FieldSpec<unknown>, 'visibleWhen'>;

/**
 * A button rather than an editable value. Used where the operation is not
 * "set this property" — extracting a material into an asset, for instance.
 */
export interface ActionSpec {
  kind: 'action';
  /** Button text. */
  title: string;
  /**
   * Label column text. Empty by default, which still puts the button in the
   * value column rather than across the whole row — a full-width button reads
   * as belonging to the component, not to the field above it.
   */
  label?: string;
  visibleWhen?: (component: ComponentDoc) => boolean;
  /** Given the window's registries with the component, for what the action expands, creates or asks. */
  run: (context: {
    registries: RuntimeRegistries;
    entityId: EntityId;
    componentId: ComponentId;
    component: ComponentDoc;
  }) => void;
}

/** A rule, to show where one group of fields ends and the next begins. */
export interface SeparatorSpec {
  kind: 'separator';
  /**
   * Never conditional, and said out loud rather than left absent.
   *
   * A rule belongs to the layout, not to a row that can come and go: hiding one
   * would leave two groups running together with nothing between them. Declared
   * so that this shares a property with the rest of `PaneRow`, which is what
   * lets `shapeOf` read a whole list of them without a cast.
   */
  visibleWhen?: never;
}

/** A row of a pane as the Inspector builds it. */
export type PaneRow = FieldSpec | ActionSpec | SeparatorSpec;

/**
 * Whether an entry is a field, by the one property only a field has.
 *
 * `kind` cannot answer it any more: `{ type: 'asset', kind: 'audio' }` is a
 * declared field whose `kind` names an asset kind, so the two guards below
 * would be reading a word that means something else in that row. `path` is
 * what a field is — it is where the value lives — and nothing that is not a
 * field has one.
 */
function isField(entry: PaneRow): entry is FieldSpec {
  return 'path' in entry;
}

export function isAction(entry: PaneRow): entry is ActionSpec {
  return !isField(entry) && entry.kind === 'action';
}

export function isSeparator(entry: PaneRow): entry is SeparatorSpec {
  return !isField(entry) && entry.kind === 'separator';
}

/**
 * What a type written as a schema adds to the pane derived from it: what the
 * schema cannot say. A handful of buttons, a choice the project or the scene
 * supplies, one value shown as two rows, a script's declared properties.
 *
 * An extension and not a pane of its own: every row a schema can say is
 * derived, and a type that wanted one button more would otherwise copy its
 * whole pane to add it — the second list a schema exists to remove.
 *
 * Erased to `ComponentDoc` so that one registry holds every type's; a type's
 * editor part writes one with `extendPane`, typed by its own component.
 */
export interface PaneExtension {
  readonly id: ComponentTypeId;
  /**
   * Rows in place of a field's own row — a leaf's, a union's selector — keyed
   * by the field. The rows the field holds follow: a union's variant, an
   * object's fields. Handed the row derivation gave, or `null` where it gives
   * none. Asked once per pane key: rows that depend on more than the variants
   * the component holds say what with `paneKey`.
   */
  readonly drawers?: { readonly [key: string]: Drawer<ComponentDoc> | undefined };
  /** Entries after a field's last row — an object's or a union's included — keyed by the field. */
  readonly after?: { readonly [key: string]: readonly PaneRow[] | undefined };
  /** What else makes the rows another list, beyond the variants the component holds. */
  readonly paneKey?: (component: ComponentDoc) => string;
  /**
   * Its rows tune the running game during Play, where every other row is
   * locked. The running world takes the value; the document does not. Declared
   * by the components the world builds — `rigidbody`, `collider` and `joint`.
   */
  readonly live?: true;
}

/** Rows in place of a field's own; see `PaneExtension.drawers`. */
type Drawer<C> = (row: FieldSpec | null, component: C) => readonly PaneRow[];

/** A type's own fields: what an extension's drawers and entries are keyed by. */
type FieldKey<C> = Exclude<keyof C & string, 'id' | 'type'>;

/**
 * A type's pane extension, written against its own component, so that a
 * misspelt field does not compile and a drawer reads the type's fields with no
 * cast. Each callback is asked of the type's own components alone.
 */
export function extendPane<T extends ComponentType>(
  id: T,
  extension: {
    readonly drawers?: { readonly [K in FieldKey<ComponentOfType<T>>]?: Drawer<ComponentOfType<T>> };
    readonly after?: { readonly [K in FieldKey<ComponentOfType<T>>]?: readonly PaneRow[] };
    readonly paneKey?: (component: ComponentOfType<T>) => string;
    readonly live?: true;
  },
): PaneExtension {
  const { drawers, after, paneKey, live } = extension;
  const drawn: Record<string, Drawer<ComponentDoc>> = {};
  // Read through an index signature, which the mapped type of the type's keys
  // is assignable to: a loop over its own keys cannot be typed by them.
  const typed: { readonly [key: string]: Drawer<ComponentOfType<T>> | undefined } = drawers ?? {};
  for (const [key, draw] of Object.entries(typed)) {
    if (draw !== undefined) drawn[key] = (row, component) => (isComponentOfType(component, id) ? draw(row, component) : []);
  }
  return {
    id,
    ...(drawers === undefined ? {} : { drawers: drawn }),
    ...(after === undefined ? {} : { after }),
    ...(paneKey === undefined
      ? {}
      : { paneKey: (component: ComponentDoc) => (isComponentOfType(component, id) ? paneKey(component) : '') }),
    ...(live === undefined ? {} : { live }),
  };
}

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

/**
 * Angles are stored in radians and always shown in degrees.
 *
 * A converter pair rather than a declared variant, and the line is worth
 * knowing: a tuple bound as a pad *must* be converted, so `vec2` and `vec3`
 * carry their own conversion, but showing an angle in degrees is a choice —
 * `particleEmitter.velocity` is three numbers that are not an angle at all.
 */
export const asDegrees: Pick<FieldSpec, 'toModel' | 'fromModel'> = {
  toModel: (value) => (value as number) * RAD_TO_DEG,
  fromModel: (value) => (value as number) * DEG_TO_RAD,
};

/**
 * A slot stores `null` when empty, but the control needs a primitive, so the
 * empty choice round-trips through `''`.
 *
 * `view: 'asset'` picks our own control (`assetField.ts`): a thumbnail, the
 * textures already imported, and a picker that imports into the project before
 * assigning.
 */
/**
 * What makes a field an asset picker, with no opinion on where it lives.
 *
 * Separate from `assetSlot` because the scene pane addresses its fields by
 * block and key rather than by path, and these three properties are the whole
 * of what the two have in common.
 */
export const ASSET_SLOT = {
  params: { view: 'asset', assetKind: 'texture' },
  toModel: (value: unknown) => value ?? '',
  fromModel: (value: unknown) => (value === '' ? null : value),
} satisfies DistributiveOmit<FieldSpec<never>, 'path' | 'label' | 'type'>;

/**
 * One asset slot, for whichever kind of asset it holds.
 *
 * The kind is a parameter rather than four near-identical helpers, and it has
 * a default because two thirds of the slots in the editor are textures. It was
 * texture-only until the panes that needed audio and material slots wrote the
 * Tweakpane parameters out by hand instead — which is exactly the leak this
 * vocabulary exists to stop.
 */
export const assetSlot = <Subject,>(
  path: readonly string[],
  label: string,
  assetKind: AssetKind = 'texture',
  emptyLabel?: string,
): FieldSpec<Subject> => ({
  ...ASSET_SLOT,
  path,
  label,
  params: { view: 'asset', assetKind, ...(emptyLabel === undefined ? {} : { emptyLabel }) },
});
