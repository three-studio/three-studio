import type { AssetKind } from './assets/kind';
import { isRecord } from './conform';
import {
  checks,
  formatDiagnostics,
  invalid,
  missing,
  nullable,
  oneOf,
  shown,
  unexpected,
  type Check,
  type DecodePath,
  type Decoded,
  type Diagnostic,
} from './decoded';
import { isAssetId, isEntityId, type AssetId, type EntityId } from './ids';
import type { Hex, Vec2, Vec3 } from './scene/primitives';

/*
 * A type's fields, written once.
 *
 * A component type used to be said five times: an interface, a factory, a
 * `fill` for the files written before a field existed, a list of the fields
 * that name an asset, and a pane. Five lists kept in step by hand, and the ones
 * that drifted shipped: a field missing from the factory reached three as
 * `undefined`, and a sprite missing from the asset list shipped in no build.
 *
 * A schema is the one list. The TypeScript type is inferred from it (`Infer`),
 * and `planFields` derives the rest: the defaults, a decoder for a stored
 * value, the assets and the entities a value names, and the renaming of those
 * entities when a copy is made. The Inspector derives the pane from the same
 * fields.
 *
 * The leaves are written in `FieldDef`'s words, the vocabulary a script and an
 * importer already declare theirs in, so there is one way to say "a number
 * between 0 and 1". Data is rarely flat, so a field may also hold an object of
 * fields, a union of such objects told apart by their `kind` — a collider's
 * shapes, a mesh's primitives — or data something else shapes and decodes, such
 * as a script's declared properties. A field must also say what `FieldDef`
 * leaves open, since a type's data has no other source: its label, and its
 * default.
 */

/** What a condition compares a field with: what a leaf can hold, and `null` for an empty slot. */
type ConditionValue = string | number | boolean | null;

/**
 * The value a field's row is shown under, read from another field: a radius
 * means nothing to a box. The value is stored either way, so that choosing the
 * sphere again brings its radius back.
 *
 * `field` names a field of the same object or of one around it, the nearest
 * first: a shadow's settings read their light's `castShadow`, a material's
 * strength its own map. Never a field inside a sibling: a row that hid on a
 * value the pane shows elsewhere would be a row nobody could explain.
 */
export type ShownWhen =
  | { readonly field: string; readonly equals: ConditionValue }
  | { readonly field: string; readonly oneOf: readonly ConditionValue[] }
  | { readonly field: string; readonly notEquals: ConditionValue };

/** What a field carries beside its kind: its row's label, and where and whether that row sits. */
interface FieldFacts {
  readonly label: string;
  /** A rule above this field's row, where one group of rows ends and the next begins. */
  readonly separatorBefore?: true;
  /** See `ShownWhen`. On an object or a union, it holds for each of its rows, with theirs. */
  readonly shownWhen?: ShownWhen;
  /**
   * `false`: the pane draws no row for it, though the value is stored and
   * decoded like any other — a mesh's primitive, chosen when the mesh is added
   * and never changed after. On a union, the selector alone goes, and the
   * active variant's rows stay.
   */
  readonly shown?: false;
}

/** What a numeric row offers. A stored value is not held to them. */
interface Bounds {
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}

/**
 * An angle stored in radians — what three reads — and shown in degrees, what
 * a person types. Its bounds are written in degrees, as the row shows them;
 * its default in radians, as it is stored.
 */
type Angle = { readonly unit?: 'radians' };

/**
 * What an empty asset slot or entity field is called where "None" would
 * mislead: a joint with no body is joined to the World, a model with no
 * material keeps the one from its file.
 */
type EmptyChoice = { readonly emptyLabel?: string };

/** A union's variant: its name in the selector, and its fields beside `kind`. */
interface Variant {
  readonly label: string;
  readonly fields: Schema;
}

/** A union's variants, by the `kind` each is stored under. Their order is the selector's. */
interface Variants {
  readonly [kind: string]: Variant;
}

export type SchemaField = FieldFacts &
  (
    | ({ readonly type: 'number'; readonly default: number } & Bounds & Angle)
    | { readonly type: 'boolean'; readonly default: boolean }
    | { readonly type: 'string'; readonly default: string }
    | { readonly type: 'color'; readonly default: Hex }
    | ({ readonly type: 'vec2'; readonly default: Readonly<Vec2> } & Bounds)
    | ({ readonly type: 'vec3'; readonly default: Readonly<Vec3> } & Bounds & Angle)
    | {
        readonly type: 'enum';
        readonly default: string;
        readonly options: readonly { readonly value: string; readonly label: string }[];
      }
    /** An asset of one kind, or none: its default is `null`, since no project is known here. */
    | ({ readonly type: 'asset'; readonly kind: AssetKind } & EmptyChoice)
    /** Another entity of the scene, or none: its default is `null`, since no scene is known here. */
    | ({ readonly type: 'entity' } & EmptyChoice)
    /** Fields of their own, stored as one object. Its default is its fields'. */
    | { readonly type: 'object'; readonly fields: Schema }
    /**
     * One of several objects, told apart by the `kind` each is stored with:
     * `{ kind: 'sphere', radius: 0.5 }`. `default` names a variant, and the
     * value starts at that variant's defaults.
     */
    | { readonly type: 'union'; readonly default: string; readonly variants: Variants }
    /**
     * Data something else shapes — a script's declared properties, a prefab's
     * overrides — decoded by `decode`, and never drawn by derivation.
     * `candidates`: each string in it may name an asset or an entity, and only
     * the data's owner knows which, so each is counted where one answers to it
     * and renamed where it names a copied entity.
     */
    | {
        readonly type: 'custom';
        readonly default: unknown;
        decode(value: unknown, path: DecodePath): Decoded<unknown>;
        readonly candidates?: true;
      }
  );

/** A type's fields by the key each is stored under. Their order is the order of the pane's rows. */
export interface Schema {
  readonly [key: string]: SchemaField;
}

/** The value of one variant: its `kind`, then its fields. */
type VariantValue<Name extends string, Fields extends Schema> = {
  -readonly [Key in 'kind' | keyof Fields]: Key extends 'kind'
    ? Name
    : Key extends keyof Fields
      ? ValueOf<Fields[Key]>
      : never;
};

type ValueOf<Field> = Field extends { readonly type: 'number' }
  ? number
  : Field extends { readonly type: 'boolean' }
    ? boolean
    : Field extends { readonly type: 'string' }
      ? string
      : Field extends { readonly type: 'color' }
        ? Hex
        : Field extends { readonly type: 'vec2' }
          ? Vec2
          : Field extends { readonly type: 'vec3' }
            ? Vec3
            : Field extends { readonly type: 'enum'; readonly options: readonly { readonly value: infer Value }[] }
              ? Value
              : Field extends { readonly type: 'asset' }
                ? AssetId | null
                : Field extends { readonly type: 'entity' }
                  ? EntityId | null
                  : Field extends { readonly type: 'object'; readonly fields: infer Fields extends Schema }
                    ? Infer<Fields>
                    : Field extends { readonly type: 'union'; readonly variants: infer V extends Variants }
                      ? { [Name in keyof V & string]: VariantValue<Name, V[Name]['fields']> }[keyof V & string]
                      : Field extends { readonly type: 'custom'; decode(value: unknown, path: DecodePath): Decoded<infer T> }
                        ? T
                        : never;

/**
 * The value a schema describes. A schema written `as const` gives an `enum` the
 * union of its options and a union the union of its variants, where a plain
 * literal would give `string`.
 */
export type Infer<S extends Schema> = { -readonly [Key in keyof S]: ValueOf<S[Key]> };

/** The `kind`s of a union field's variants; `never` for any other field. */
type VariantName<Field> = Field extends { readonly type: 'union'; readonly variants: infer V } ? keyof V & string : never;

/** What `planFields` derives from a schema, once. */
export interface FieldPlan<S extends Schema> {
  /**
   * Each field at its default. One object for every reader: copy it before
   * handing it out as a new value.
   */
  readonly defaults: Infer<S>;
  /**
   * A stored value, checked field by field, through objects and the variant
   * its `kind` names. Strict: a missing field, a field of the wrong kind and a
   * key that is no field are each refused, and every fault is reported, not
   * the first alone. `path` is where `value` sits in what was read, which each
   * fault's path starts with.
   */
  decode(value: unknown, path: DecodePath): Decoded<Infer<S>>;
  /** What each asset field of a value holds, in the schema's order, the active variants' alone: an id, or `null`. */
  assets(value: Infer<S>): readonly (AssetId | null)[];
  /** What each entity field of a value holds, as `assets` reads asset fields. */
  entities(value: Infer<S>): readonly (EntityId | null)[];
  /** Every string of the value's `candidates` fields; see `SchemaField`'s `custom`. */
  candidates(value: Infer<S>): readonly string[];
  /**
   * The value with each entity it names replaced by `rename`'s answer, where
   * there is one: its entity fields, and the candidate strings equal to an id.
   * What a copy needs, for the references inside the copied set to name the
   * copies. A value of its own, decoded again; the value itself when the
   * schema can name no entity.
   */
  renameEntities(value: Infer<S>, rename: (id: EntityId) => EntityId | undefined): Infer<S>;
  /** A union field's variant at its defaults, under its `kind`: what choosing it in the selector writes. A new value each time. */
  createVariant<K extends keyof S & string>(field: K, variant: VariantName<S[K]>): Infer<S>[K];
}

/*
 * A schema as planned: the same tree, each leaf holding the check it is read
 * with, each object and union what its walks can skip. Built once per type, so
 * that decoding a scene's ten thousand components asks no question twice.
 */

/** What a field may name, for the walks that list or rename it. */
type Reference = 'asset' | 'entity';

/** What lies anywhere under an object or a union: the walks skip a branch that holds none of what they read. */
interface Holds {
  readonly asset: boolean;
  readonly entity: boolean;
  readonly candidates: boolean;
}

interface PlannedLeaf {
  readonly form: 'leaf';
  readonly check: Check<unknown>;
  readonly reference: Reference | null;
}

interface PlannedEntry {
  readonly key: string;
  readonly field: SchemaField;
  readonly node: Planned;
}

interface PlannedObject {
  readonly form: 'object';
  readonly entries: readonly PlannedEntry[];
  readonly keys: ReadonlySet<string>;
  readonly holds: Holds;
}

interface PlannedUnion {
  readonly form: 'union';
  readonly variants: ReadonlyMap<string, PlannedObject>;
  /** The variants' names, as a check: what a `kind` has to be. */
  readonly kinds: Check<string>;
  readonly holds: Holds;
}

interface PlannedCustom {
  readonly form: 'custom';
  decode(value: unknown, path: DecodePath): Decoded<unknown>;
  readonly candidates: boolean;
}

type Planned = PlannedLeaf | PlannedObject | PlannedUnion | PlannedCustom;

function leaf(check: Check<unknown>, reference: Reference | null = null): PlannedLeaf {
  return { form: 'leaf', check, reference };
}

function holdsOf(nodes: readonly Planned[]): Holds {
  let asset = false;
  let entity = false;
  let candidates = false;
  for (const node of nodes) {
    if (node.form === 'leaf') {
      asset ||= node.reference === 'asset';
      entity ||= node.reference === 'entity';
    } else if (node.form === 'custom') {
      candidates ||= node.candidates;
    } else {
      asset ||= node.holds.asset;
      entity ||= node.holds.entity;
      candidates ||= node.holds.candidates;
    }
  }
  return { asset, entity, candidates };
}

function planObject(fields: Schema): PlannedObject {
  const entries = Object.entries(fields).map(([key, field]) => ({ key, field, node: planField(field) }));
  return {
    form: 'object',
    entries,
    keys: new Set(entries.map((entry) => entry.key)),
    holds: holdsOf(entries.map((entry) => entry.node)),
  };
}

function planField(field: SchemaField): Planned {
  switch (field.type) {
    case 'number':
    case 'boolean':
    case 'string':
    case 'color':
    case 'vec2':
    case 'vec3':
      return leaf(checks[field.type]);
    case 'enum':
      return leaf(oneOf(field.options.map((option) => option.value)));
    case 'asset':
      return leaf(nullable(checks.assetId), 'asset');
    case 'entity':
      return leaf(nullable(checks.entityId), 'entity');
    case 'object':
      return planObject(field.fields);
    case 'union': {
      const variants = new Map(Object.entries(field.variants).map(([kind, variant]) => [kind, planObject(variant.fields)]));
      return { form: 'union', variants, kinds: oneOf([...variants.keys()]), holds: holdsOf([...variants.values()]) };
    }
    case 'custom':
      return { form: 'custom', decode: field.decode, candidates: field.candidates === true };
  }
}

// ---------------------------------------------------------------- decoding

function decodeNode(node: Planned, value: unknown, path: DecodePath, faults: Diagnostic[]): unknown {
  switch (node.form) {
    case 'leaf':
      if (node.check.is(value)) return value;
      faults.push(invalid(path, node.check.expected, value));
      return undefined;
    case 'object':
      return decodeObject(node, value, path, faults, null);
    case 'union': {
      if (!isRecord(value)) {
        faults.push(invalid(path, 'an object', value));
        return undefined;
      }
      const kind = Object.hasOwn(value, 'kind') ? value['kind'] : undefined;
      const variant = node.kinds.is(kind) ? node.variants.get(kind) : undefined;
      if (variant === undefined || typeof kind !== 'string') {
        faults.push({
          code: 'variant.unknown',
          message: `expected ${node.kinds.expected}, found ${shown(kind)}`,
          path: [...path, 'kind'],
        });
        return undefined;
      }
      return decodeObject(variant, value, path, faults, kind);
    }
    case 'custom': {
      const decoded = node.decode(value, path);
      if (decoded.ok) return decoded.value;
      faults.push(...decoded.diagnostics);
      return undefined;
    }
  }
}

/**
 * An object's fields, each checked against its own, then each key that is
 * none refused. `kind` is a variant's name, which it is stored with and which
 * is none of its fields.
 */
function decodeObject(
  node: PlannedObject,
  value: unknown,
  path: DecodePath,
  faults: Diagnostic[],
  kind: string | null,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    faults.push(invalid(path, 'an object', value));
    return undefined;
  }
  const out: Record<string, unknown> = kind === null ? {} : { kind };
  for (const { key, node: field } of node.entries) {
    // Its own keys only, here and below: a file may name a key `constructor`,
    // which every object answers to without holding it.
    if (!Object.hasOwn(value, key)) {
      faults.push(missing([...path, key]));
      continue;
    }
    const held = value[key];
    if (field.form !== 'leaf') {
      out[key] = decodeNode(field, held, [...path, key], faults);
    } else if (field.check.is(held)) {
      // Most fields are leaves: no path is built for one unless it is refused.
      out[key] = held;
    } else {
      faults.push(invalid([...path, key], field.check.expected, held));
    }
  }
  for (const key in value) {
    if (Object.hasOwn(value, key) && !node.keys.has(key) && !(kind !== null && key === 'kind')) {
      faults.push(unexpected([...path, key]));
    }
  }
  return out;
}

// ---------------------------------------------------------------- defaults

/** What a schema's fields declare as their defaults, as plain data the decoder then checks. */
function declared(fields: Schema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(fields)) out[key] = declaredValue(field);
  return out;
}

function declaredValue(field: SchemaField): unknown {
  switch (field.type) {
    case 'asset':
    case 'entity':
      return null;
    case 'object':
      return declared(field.fields);
    case 'union':
      return declaredVariant(field.variants, field.default);
    default:
      return field.default;
  }
}

/** A variant at its declared defaults, under its `kind`; the `kind` alone when it names none, for the decoder to refuse. */
function declaredVariant(variants: Variants, kind: string): Record<string, unknown> {
  const variant = Object.hasOwn(variants, kind) ? variants[kind] : undefined;
  return { kind, ...(variant === undefined ? {} : declared(variant.fields)) };
}

/** A union field of a schema. */
type UnionField = Extract<SchemaField, { readonly type: 'union' }>;

/**
 * A union field's variant at its defaults, under its `kind`: what choosing it
 * in the Inspector's selector writes, as one value, for any schema. A new value
 * each time. Typed code that knows its schema asks `FieldPlan.createVariant`,
 * which says the same through the decoder.
 */
export function variantDefaults(field: UnionField, kind: string): Record<string, unknown> {
  return structuredClone(declaredVariant(field.variants, kind));
}

// -------------------------------------------------------------- conditions

/** Whether a value satisfies a condition: what a row's visibility asks of the field it reads. */
export function conditionHolds(condition: ShownWhen, value: unknown): boolean {
  if ('equals' in condition) return value === condition.equals;
  if ('oneOf' in condition) return condition.oneOf.some((option) => option === value);
  return value !== condition.notEquals;
}

/** A condition as a refusal quotes it: `equals "sun"`. */
function said(condition: ShownWhen): string {
  if ('equals' in condition) return `equals ${shown(condition.equals)}`;
  if ('oneOf' in condition) return `is one of ${condition.oneOf.map(shown).join(', ')}`;
  return `differs from ${shown(condition.notEquals)}`;
}

function valuesOf(condition: ShownWhen): readonly ConditionValue[] {
  if ('equals' in condition) return [condition.equals];
  if ('oneOf' in condition) return condition.oneOf;
  return [condition.notEquals];
}

/**
 * Why a field's condition cannot be met, or `null`: the field it reads is
 * found in none of the objects around it, nearest first, or holds no value the
 * condition names.
 */
function conditionProblem(where: string, condition: ShownWhen, around: readonly PlannedObject[]): string | null {
  const name = condition.field;
  const watched = around.find((object) => object.keys.has(name))?.entries.find((entry) => entry.key === name)?.node;
  if (watched === undefined) return `${where}: shown when "${name}", which is no field of its object nor of one around it`;
  const cannot = `${where}: shown when "${name}" ${said(condition)}, which that field cannot hold`;
  if (watched.form !== 'leaf') return `${cannot} (it holds no single value)`;
  const refused = valuesOf(condition).find((value) => !watched.check.is(value));
  return refused === undefined ? null : `${cannot} (expected ${watched.check.expected}, found ${shown(refused)})`;
}

/**
 * Every contradiction in an object's fields that its defaults do not show:
 * conditions, a variant claiming `kind`, the defaults of the variants that are
 * no default. `around` holds the objects enclosing it, nearest first; `where`
 * names it as the schema is written, a variant by its `kind`.
 */
function inspect(object: PlannedObject, around: readonly PlannedObject[], where: string, problems: string[]): void {
  const scopes = [object, ...around];
  for (const { key, field, node } of object.entries) {
    const at = where === '' ? key : `${where}.${key}`;
    const problem = field.shownWhen === undefined ? null : conditionProblem(at, field.shownWhen, scopes);
    if (problem !== null) problems.push(problem);
    if (node.form === 'object') inspect(node, scopes, at, problems);
    if (node.form !== 'union' || field.type !== 'union') continue;
    for (const [kind, variant] of node.variants) {
      if (variant.keys.has('kind')) {
        problems.push(`${at}.${kind}.kind: a variant holds no field named "kind", which is what names the variant`);
      }
      inspect(variant, scopes, `${at}.${kind}`, problems);
      const faults: Diagnostic[] = [];
      decodeNode(node, declaredVariant(field.variants, kind), [at], faults);
      problems.push(...faults.map((fault) => `${fault.path.join('.')}: its default — ${fault.message}`));
    }
  }
}

// ------------------------------------------------------------------ walks

function activeVariant(node: PlannedUnion, value: unknown): PlannedObject | undefined {
  if (!isRecord(value)) return undefined;
  const kind = value['kind'];
  return typeof kind === 'string' ? node.variants.get(kind) : undefined;
}

function collectReferences<T>(
  node: Planned,
  value: unknown,
  reference: Reference,
  is: (value: unknown) => value is T,
  out: (T | null)[],
): void {
  switch (node.form) {
    case 'leaf':
      if (node.reference === reference) out.push(is(value) ? value : null);
      return;
    case 'object':
      if (!node.holds[reference] || !isRecord(value)) return;
      for (const { key, node: field } of node.entries) collectReferences(field, value[key], reference, is, out);
      return;
    case 'union': {
      const variant = node.holds[reference] ? activeVariant(node, value) : undefined;
      if (variant !== undefined) collectReferences(variant, value, reference, is, out);
      return;
    }
    case 'custom':
      return;
  }
}

/** Every string in a value, at any depth: the candidates of data only its owner can read. */
function stringsIn(value: unknown, out: string[]): void {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const item of value) stringsIn(item, out);
  else if (isRecord(value)) for (const item of Object.values(value)) stringsIn(item, out);
}

function collectCandidates(node: Planned, value: unknown, out: string[]): void {
  switch (node.form) {
    case 'leaf':
      return;
    case 'object':
      if (!node.holds.candidates || !isRecord(value)) return;
      for (const { key, node: field } of node.entries) collectCandidates(field, value[key], out);
      return;
    case 'union': {
      const variant = node.holds.candidates ? activeVariant(node, value) : undefined;
      if (variant !== undefined) collectCandidates(variant, value, out);
      return;
    }
    case 'custom':
      if (node.candidates) stringsIn(value, out);
      return;
  }
}

type Rename = (id: EntityId) => EntityId | undefined;

/** Every string in a value that is an id `rename` answers for, replaced by its answer, at any depth. */
function renamedStrings(value: unknown, rename: Rename): unknown {
  if (typeof value === 'string') return (isEntityId(value) ? rename(value) : undefined) ?? value;
  if (Array.isArray(value)) return value.map((item) => renamedStrings(item, rename));
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) out[key] = renamedStrings(item, rename);
  return out;
}

function renamed(node: Planned, value: unknown, rename: Rename): unknown {
  switch (node.form) {
    case 'leaf':
      return node.reference === 'entity' && isEntityId(value) ? (rename(value) ?? value) : value;
    case 'object': {
      if (!(node.holds.entity || node.holds.candidates) || !isRecord(value)) return value;
      const out: Record<string, unknown> = { ...value };
      for (const { key, node: field } of node.entries) out[key] = renamed(field, value[key], rename);
      return out;
    }
    case 'union': {
      const variant = node.holds.entity || node.holds.candidates ? activeVariant(node, value) : undefined;
      return variant === undefined ? value : renamed(variant, value, rename);
    }
    case 'custom':
      return node.candidates ? renamedStrings(value, rename) : value;
  }
}

/**
 * Everything derived from a schema, computed once, when its type is defined.
 *
 * Throws on a schema that contradicts itself — a default its own field
 * refuses, in any variant; a `shownWhen` that names no field around it or a
 * value that field cannot hold; a variant with a field named `kind` — since
 * such a schema is a mistake in the code that wrote it, and is found the first
 * time that code is loaded, by any test.
 *
 * A range is never checked, in a default or in a stored value: `min`, `max`
 * and `step` say what a slider offers, and a file may hold what a hand wrote.
 */
export function planFields<const S extends Schema>(schema: S): FieldPlan<S> {
  const fields: Schema = schema;
  const root = planObject(fields);

  const decode = (value: unknown, path: DecodePath): Decoded<Infer<S>> => {
    const faults: Diagnostic[] = [];
    const out = decodeObject(root, value, path, faults, null);
    if (out === undefined || faults.length > 0) return { ok: false, diagnostics: faults };
    // The one place the kernel claims a type. `out` holds exactly the schema's
    // keys, each checked against its field above, through every object and
    // the variant its `kind` names, which is what `Infer<S>` says — but a loop
    // over a schema's entries cannot be typed as the mapped type over its keys,
    // so the compiler has to be told. Every value the kernel hands out leaves
    // through here: the defaults, a variant's, a renamed value.
    return { ok: true, value: out as Infer<S> };
  };

  /** A value the kernel built itself, through the one typed exit; a failure is a defect of this file. */
  const rebuilt = (value: unknown, what: string): Infer<S> => {
    const decoded = decode(value, []);
    if (decoded.ok) return decoded.value;
    throw new Error(formatDiagnostics(`${what} no longer fits its schema:`, decoded.diagnostics));
  };

  const declaredRoot = declared(fields);
  const defaults = decode(declaredRoot, []);
  const problems = defaults.ok
    ? []
    : defaults.diagnostics.map((fault) => `${fault.path.join('.')}: its default — ${fault.message}`);
  inspect(root, [], '', problems);
  if (!defaults.ok || problems.length > 0) {
    throw new Error(['A schema contradicts itself:', ...new Set(problems)].join('\n  '));
  }

  return {
    defaults: defaults.value,
    decode,
    assets: (value) => {
      const out: (AssetId | null)[] = [];
      collectReferences(root, value, 'asset', isAssetId, out);
      return out;
    },
    entities: (value) => {
      const out: (EntityId | null)[] = [];
      collectReferences(root, value, 'entity', isEntityId, out);
      return out;
    },
    candidates: (value) => {
      const out: string[] = [];
      collectCandidates(root, value, out);
      return out;
    },
    renameEntities: (value, rename) =>
      root.holds.entity || root.holds.candidates ? rebuilt(renamed(root, value, rename), 'A renamed value') : value,
    createVariant: (field, variant) => {
      const union = Object.hasOwn(fields, field) ? fields[field] : undefined;
      const kind: string = variant;
      if (union?.type !== 'union' || !Object.hasOwn(union.variants, kind)) {
        throw new Error(`"${kind}" is no variant of the field "${field}"`);
      }
      const value = rebuilt({ ...declaredRoot, [field]: declaredVariant(union.variants, kind) }, `The variant "${kind}"`);
      return structuredClone(value[field]);
    },
  };
}
