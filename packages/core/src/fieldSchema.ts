import type { AssetKind } from './assets/kind';
import { isRecord, isUsableNumber } from './conform';
import { shown, type DecodePath, type Decoded, type Diagnostic } from './decoded';
import { isAssetId, type AssetId } from './ids';
import type { Hex, Vec3 } from './scene/primitives';

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
 * value, and the assets a value names. The Inspector derives the pane from the
 * same fields.
 *
 * The fields are written in `FieldDef`'s words, the vocabulary a script and an
 * importer already declare theirs in, so there is one way to say "a number
 * between 0 and 1". A schema's field must also say what `FieldDef` leaves open,
 * since a type's data has no other source: its label, and its default.
 */

/** What a field carries beside its kind: its row's label, and where that row sits. */
interface FieldFacts {
  readonly label: string;
  /** A rule above this field's row, where one group of rows ends and the next begins. */
  readonly separatorBefore?: true;
  /**
   * The row is shown only while another field of the same schema holds this
   * value: a radius means nothing to a box. The value is stored either way, so
   * that choosing the sphere again brings its radius back.
   */
  readonly shownWhen?: { readonly field: string; readonly equals: string | number | boolean };
}

export type SchemaField = FieldFacts &
  (
    | {
        readonly type: 'number';
        readonly default: number;
        /** `min`, `max` and `step` are what the row offers. A stored value is not held to them. */
        readonly min?: number;
        readonly max?: number;
        readonly step?: number;
      }
    | { readonly type: 'boolean'; readonly default: boolean }
    | { readonly type: 'color'; readonly default: Hex }
    | {
        readonly type: 'vec3';
        readonly default: Readonly<Vec3>;
        readonly min?: number;
        readonly max?: number;
        readonly step?: number;
      }
    | {
        readonly type: 'enum';
        readonly default: string;
        readonly options: readonly { readonly value: string; readonly label: string }[];
      }
    /** An asset of one kind, or none: its default is `null`, since no project is known here. */
    | { readonly type: 'asset'; readonly kind: AssetKind }
  );

/** A type's fields by the key each is stored under. Their order is the order of the pane's rows. */
export type Schema = Readonly<Record<string, SchemaField>>;

type ValueOf<Field> = Field extends { readonly type: 'number' }
  ? number
  : Field extends { readonly type: 'boolean' }
    ? boolean
    : Field extends { readonly type: 'color' }
      ? Hex
      : Field extends { readonly type: 'vec3' }
        ? Vec3
        : Field extends { readonly type: 'enum'; readonly options: readonly { readonly value: infer Value }[] }
          ? Value
          : Field extends { readonly type: 'asset' }
            ? AssetId | null
            : never;

/**
 * The value a schema describes. A schema written `as const` gives an `enum` the
 * union of its options, where a plain literal would give `string`.
 */
export type Infer<S extends Schema> = { -readonly [Key in keyof S]: ValueOf<S[Key]> };

/** What `planFields` derives from a schema, once. */
export interface FieldPlan<S extends Schema> {
  /**
   * Each field at its default. One object for every reader: copy it before
   * handing it out as a new value.
   */
  readonly defaults: Infer<S>;
  /**
   * A stored value, checked field by field. Strict: a missing field, a field of
   * the wrong kind and a key that is no field are each refused, and every fault
   * is reported, not the first alone. `path` is where `value` sits in what was
   * read, which each fault's path starts with.
   */
  decode(value: unknown, path: DecodePath): Decoded<Infer<S>>;
  /** What each asset field of a value holds, in the schema's order: an id, or `null` for none. */
  assets(value: Infer<S>): readonly (AssetId | null)[];
}

const HEX = /^#[0-9a-f]{6}$/i;

/** What a field expects, when `value` is not it; `null` when it is. */
function unmetBy(field: SchemaField, value: unknown): string | null {
  switch (field.type) {
    case 'number':
      return isUsableNumber(value) ? null : 'a finite number';
    case 'boolean':
      return typeof value === 'boolean' ? null : 'true or false';
    case 'color':
      return typeof value === 'string' && HEX.test(value) ? null : 'a colour written #rrggbb';
    case 'vec3':
      return Array.isArray(value) && value.length === 3 && value.every(isUsableNumber) ? null : 'three finite numbers';
    case 'enum':
      return field.options.some((option) => option.value === value)
        ? null
        : `one of ${field.options.map((option) => shown(option.value)).join(', ')}`;
    case 'asset':
      return value === null || isAssetId(value) ? null : 'an asset id or null';
  }
}

/** Why a field refuses a value, as a diagnostic's message; `null` when it takes it. */
function refusalOf(field: SchemaField, value: unknown): string | null {
  const expected = unmetBy(field, value);
  return expected === null ? null : `expected ${expected}, found ${shown(value)}`;
}

/**
 * Everything derived from a schema, computed once, when its type is defined.
 *
 * Throws on a schema that contradicts itself — a default its own field
 * refuses, a `shownWhen` that names no field of the schema or a value that
 * field cannot hold — since such a schema is a mistake in the code that wrote
 * it, and is found the first time that code is loaded, by any test.
 *
 * A range is never checked, in a default or in a stored value: `min`, `max`
 * and `step` say what a slider offers, and a file may hold what a hand wrote.
 */
export function planFields<const S extends Schema>(schema: S): FieldPlan<S> {
  const fields: Schema = schema;
  const entries = Object.entries(fields);

  const decode = (value: unknown, path: DecodePath): Decoded<Infer<S>> => {
    if (!isRecord(value)) {
      return { ok: false, diagnostics: [{ code: 'field.invalid', message: `expected an object, found ${shown(value)}`, path }] };
    }
    const diagnostics: Diagnostic[] = [];
    const out: Record<string, unknown> = {};
    for (const [key, field] of entries) {
      // Its own keys only, here and below: a file may name a key `constructor`,
      // which every object answers to without holding it.
      if (!Object.hasOwn(value, key)) {
        diagnostics.push({ code: 'field.missing', message: 'is missing', path: [...path, key] });
        continue;
      }
      const refusal = refusalOf(field, value[key]);
      if (refusal === null) out[key] = value[key];
      else diagnostics.push({ code: 'field.invalid', message: refusal, path: [...path, key] });
    }
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(fields, key)) {
        diagnostics.push({ code: 'field.unexpected', message: 'is no field of this type', path: [...path, key] });
      }
    }
    if (diagnostics.length > 0) return { ok: false, diagnostics };
    // The one place the kernel claims a type. `out` holds exactly the schema's
    // keys, each checked against its field just above, which is what `Infer<S>`
    // says — but a loop over a schema's entries cannot be typed as the mapped
    // type over its keys, so the compiler has to be told. Every value the
    // kernel hands out leaves through here, the defaults included.
    return { ok: true, value: out as Infer<S> };
  };

  const declared: Record<string, unknown> = {};
  for (const [key, field] of entries) declared[key] = field.type === 'asset' ? null : field.default;
  const defaults = decode(declared, []);

  const problems = defaults.ok
    ? []
    : defaults.diagnostics.map((fault) => `${fault.path.join('.')}: its default — ${fault.message}`);
  for (const [key, field] of entries) {
    const condition = field.shownWhen;
    if (condition === undefined) continue;
    const watched = Object.hasOwn(fields, condition.field) ? fields[condition.field] : undefined;
    const refusal = watched === undefined ? null : refusalOf(watched, condition.equals);
    if (watched === undefined) {
      problems.push(`${key}: shown when "${condition.field}", which is no field of this schema`);
    } else if (refusal !== null) {
      problems.push(
        `${key}: shown when "${condition.field}" equals ${shown(condition.equals)}, which that field cannot hold (${refusal})`,
      );
    }
  }
  if (!defaults.ok || problems.length > 0) {
    throw new Error(['A schema contradicts itself:', ...problems].join('\n  '));
  }

  const assetKeys: Extract<keyof S, string>[] = [];
  // `for…in` and not `Object.keys`: it is what gives a key the type of the
  // schema's own, so that reading a value by it needs no claim.
  for (const key in schema) {
    if (schema[key]?.type === 'asset') assetKeys.push(key);
  }

  return {
    defaults: defaults.value,
    decode,
    assets: (value) =>
      assetKeys.map((key) => {
        const held: unknown = value[key];
        return isAssetId(held) ? held : null;
      }),
  };
}
