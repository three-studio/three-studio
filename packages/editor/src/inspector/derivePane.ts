import {
  conditionHolds,
  isRecord,
  variantDefaults,
  type ComponentDoc,
  type ComponentTypeId,
  type Schema,
  type SchemaField,
  type ShownWhen,
} from '@three-studio/core';
import { useDocumentStore } from '../state/documentStore';
import { entityChoices } from './declaredFields';
import { assetSlot, type FieldSpec, type PaneExtension, type PaneRow } from './fields';
import { readPath } from './target';

/*
 * The pane a type written as a schema shows, derived from its fields.
 *
 * A row per leaf, in the schema's order; an object's rows at their paths, each
 * under the object's condition and its own; a union's selector, then the rows
 * of the variant the component holds; nothing for data shaped elsewhere, which
 * the type's extension draws. The fields already say all of it — label, range,
 * unit, the condition a row is shown under — and a pane written beside them
 * would be the second list a schema exists to remove.
 *
 * Derived once per type and per combination of variants: the Inspector asks for
 * a component's rows on every change of the document, once a frame while a
 * slider is dragged, and what it gets back is the same array until the
 * component holds another variant.
 */

/** What the Inspector shows for a component: its rows, and what makes them another list. */
export interface PaneRows {
  readonly key: string;
  readonly entries: readonly PaneRow[];
}

/** An object whose fields a condition may read, and where it sits in the component. */
interface Scope {
  readonly fields: Schema;
  readonly path: readonly string[];
}

/** A condition, and the path of the field it reads. */
interface Resolved {
  readonly path: readonly string[];
  readonly condition: ShownWhen;
}

/** The rows one top-level field gives: its own — a leaf's, a union's selector — then those it holds. */
interface FieldRows {
  readonly key: string;
  readonly separatorBefore: boolean;
  /** The field is `tunable`, so every row drawn for it is: its own, a drawer's in its place, those it holds. */
  readonly tunable: boolean;
  readonly own: FieldSpec | null;
  readonly nested: readonly PaneRow[];
}

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

const toDegrees = (value: unknown): unknown => (typeof value === 'number' ? value * RAD_TO_DEG : value);
const toRadians = (value: unknown): unknown => (typeof value === 'number' ? value * DEG_TO_RAD : value);

/**
 * An angle stored in radians, shown in degrees. A vector is converted pad and
 * all here, since a row's converters take over from the ones its kind declares.
 */
const IN_DEGREES = {
  number: { toModel: toDegrees, fromModel: toRadians },
  vec3: {
    toModel: (value: unknown) =>
      Array.isArray(value) ? { x: toDegrees(value[0]), y: toDegrees(value[1]), z: toDegrees(value[2]) } : value,
    fromModel: (value: unknown) =>
      isRecord(value) ? [toRadians(value['x']), toRadians(value['y']), toRadians(value['z'])] : value,
  },
} satisfies Record<string, Pick<FieldSpec<unknown>, 'toModel' | 'fromModel'>>;

/** The bounds a field gives, and only those: an absent bound is not a bound of `undefined`. */
function bounds(field: { readonly min?: number; readonly max?: number; readonly step?: number }): {
  min?: number;
  max?: number;
  step?: number;
} {
  return {
    ...(field.min === undefined ? {} : { min: field.min }),
    ...(field.max === undefined ? {} : { max: field.max }),
    ...(field.step === undefined ? {} : { step: field.step }),
  };
}

/** A field that holds one value, which one row edits: no object, union or data shaped elsewhere. */
export type LeafField = Exclude<SchemaField, { readonly type: 'object' | 'union' | 'custom' }>;

/**
 * A leaf as the row that edits it, for whatever pane it sits in: a
 * component's, or the scene's, whose rows are the environment schema's.
 */
export function leafRow<Subject = ComponentDoc>(field: LeafField, path: readonly string[]): FieldSpec<Subject> {
  const { label } = field;
  switch (field.type) {
    case 'number':
      return { path, label, type: 'number', ...bounds(field), ...(field.unit === 'radians' ? IN_DEGREES.number : {}) };
    case 'vec2':
      return { path, label, type: 'vec2', ...bounds(field) };
    case 'vec3':
      return { path, label, type: 'vec3', ...bounds(field), ...(field.unit === 'radians' ? IN_DEGREES.vec3 : {}) };
    case 'enum':
      return { path, label, type: 'enum', options: field.options };
    case 'asset':
      return assetSlot(path, label, field.kind, field.emptyLabel);
    case 'entity':
      return {
        path,
        label,
        type: 'entity',
        // Read when the pane is built, as every list of the scene's entities
        // is. The empty choice is carried as `''`, as an asset slot's is.
        optionsProvider: () => ({ [field.emptyLabel ?? 'None']: '', ...entityChoices(useDocumentStore.getState().scene) }),
        toModel: (value) => value ?? '',
        fromModel: (value) => (value === '' ? null : value),
      };
    case 'boolean':
    case 'string':
    case 'color':
      // Nothing to declare: the control is built from the value — a checkbox,
      // a text field, a picker for `#rrggbb`.
      return { path, label };
  }
}

/** A union's selector: its variants by label, reading the `kind` and writing the chosen variant whole, as one step. */
function selectorRow(field: Extract<SchemaField, { readonly type: 'union' }>, path: readonly string[]): FieldSpec {
  return {
    path,
    label: field.label,
    type: 'enum',
    options: Object.entries(field.variants).map(([value, variant]) => ({ value, label: variant.label })),
    toModel: (value) => (isRecord(value) ? value['kind'] : value),
    // A variant shares no field with another, so the chosen one starts from
    // its own defaults, written with its `kind` as one value.
    fromModel: (kind) => (typeof kind === 'string' ? variantDefaults(field, kind) : kind),
  };
}

/** `row` shown only while every condition holds, each read at its field's path. */
function under(row: FieldSpec, conditions: readonly Resolved[]): FieldSpec {
  if (conditions.length === 0) return row;
  return {
    ...row,
    visibleWhen: (subject: object) =>
      conditions.every(({ path, condition }) => conditionHolds(condition, readPath(subject, path))),
  };
}

/** A row of a tunable field marked so; any other row as it is. */
function tuned(row: PaneRow, tunable: boolean): PaneRow {
  return tunable && 'path' in row ? { ...row, tunable: true } : row;
}

/**
 * Where a condition's field is: in the nearest scope that holds it, as the
 * kernel resolved it when the type was planned — which also refused a name
 * found in none, so the throw here is a schema no type was defined with.
 */
function resolved(condition: ShownWhen, scopes: readonly Scope[]): Resolved {
  const scope = scopes.find((candidate) => Object.hasOwn(candidate.fields, condition.field));
  if (scope === undefined) throw new Error(`No field "${condition.field}" around a row shown when it holds a value`);
  return { path: [...scope.path, condition.field], condition };
}

/**
 * The rows of one field at `path`, under the conditions of the objects around
 * it, each marked tunable where the field or one around it is (`tunable`).
 */
function rowsOfField(
  field: SchemaField,
  path: readonly string[],
  scopes: readonly Scope[],
  conditions: readonly Resolved[],
  tunable: boolean,
  subject: object,
): { own: FieldSpec | null; nested: readonly PaneRow[] } {
  const all = field.shownWhen === undefined ? conditions : [...conditions, resolved(field.shownWhen, scopes)];
  const tunes = tunable || field.tunable === true;
  const own = (row: FieldSpec): FieldSpec => (tunes ? { ...under(row, all), tunable: true } : under(row, all));
  switch (field.type) {
    case 'object':
      return {
        own: null,
        nested:
          field.shown === false
            ? []
            : rowsIn(field.fields, path, [{ fields: field.fields, path }, ...scopes], all, tunes, subject),
      };
    case 'union': {
      const kind = readPath(subject, [...path, 'kind']);
      const variant = typeof kind === 'string' && Object.hasOwn(field.variants, kind) ? field.variants[kind] : undefined;
      return {
        own: field.shown === false ? null : own(selectorRow(field, path)),
        nested:
          variant === undefined
            ? []
            : rowsIn(variant.fields, path, [{ fields: variant.fields, path }, ...scopes], all, tunes, subject),
      };
    }
    case 'custom':
      return { own: null, nested: [] };
    default:
      return { own: field.shown === false ? null : own(leafRow(field, path)), nested: [] };
  }
}

/** Every row of an object's fields, in their order, a rule before a field that asks for one. */
function rowsIn(
  fields: Schema,
  path: readonly string[],
  scopes: readonly Scope[],
  conditions: readonly Resolved[],
  tunable: boolean,
  subject: object,
): PaneRow[] {
  const entries: PaneRow[] = [];
  for (const [key, field] of Object.entries(fields)) {
    const { own, nested } = rowsOfField(field, [...path, key], scopes, conditions, tunable, subject);
    const rows = own === null ? nested : [own, ...nested];
    if (field.separatorBefore && rows.length > 0) entries.push({ kind: 'separator' });
    entries.push(...rows);
  }
  return entries;
}

/** The rows of a schema's top-level fields, each apart, for an extension to draw in place of or follow. */
function fieldRows(schema: Schema, subject: object): FieldRows[] {
  const scopes: readonly Scope[] = [{ fields: schema, path: [] }];
  return Object.entries(schema).map(([key, field]) => ({
    key,
    separatorBefore: field.separatorBefore === true,
    tunable: field.tunable === true,
    ...rowsOfField(field, [key], scopes, [], false, subject),
  }));
}

/** A union of a schema, where it sits, and the unions inside each of its variants. */
interface UnionAt {
  /** Where its `kind` is read. */
  readonly kindPath: readonly string[];
  readonly inner: ReadonlyMap<string, readonly UnionAt[]>;
}

/** Every union of `fields` outside a variant, objects walked into, each with those of its variants. */
function unionsIn(fields: Schema, path: readonly string[]): UnionAt[] {
  const unions: UnionAt[] = [];
  for (const [key, field] of Object.entries(fields)) {
    if (field.type === 'object') unions.push(...unionsIn(field.fields, [...path, key]));
    if (field.type !== 'union') continue;
    const at = [...path, key];
    const inner = new Map(Object.entries(field.variants).map(([kind, variant]) => [kind, unionsIn(variant.fields, at)]));
    unions.push({ kindPath: [...at, 'kind'], inner });
  }
  return unions;
}

/**
 * The unions of each schema, found once: the pane's key is asked for on every
 * change of the document, once a frame during a drag, and a type with no union
 * — most of them — then costs a lookup.
 */
const unionsOf = new WeakMap<Schema, readonly UnionAt[]>();

/** `key`, then the `kind` of each union the subject holds, outermost first: what makes its rows another list. */
function withKinds(key: string, unions: readonly UnionAt[], subject: object): string {
  let keyed = key;
  for (const union of unions) {
    const kind = readPath(subject, union.kindPath);
    const inner = typeof kind === 'string' ? union.inner.get(kind) : undefined;
    if (typeof kind !== 'string' || inner === undefined) continue;
    keyed = withKinds(`${keyed}:${kind}`, inner, subject);
  }
  return keyed;
}

/**
 * The panes derived so far, by what they were derived from — the extension
 * when there is one, else the schema — then by key. An extension serves one
 * type, so one schema; and both are constants of the window's registries, so
 * what they key lives as long as they do.
 */
const derived = new WeakMap<object, Map<string, PaneRows>>();

/**
 * The pane a component of a type written as a schema shows: its rows derived
 * for the variants it holds, its extension's drawn in place of a field's own
 * or put after a field's last row.
 *
 * Its key is the type, each union's variant, then the extension's own key.
 */
export function derivedPane(
  id: ComponentTypeId,
  schema: Schema,
  extension: PaneExtension | undefined,
  component: ComponentDoc,
): PaneRows {
  let unions = unionsOf.get(schema);
  if (unions === undefined) {
    unions = unionsIn(schema, []);
    unionsOf.set(schema, unions);
  }
  const extra = extension?.paneKey?.(component);
  const variants = withKinds(id, unions, component);
  const key = extra === undefined ? variants : `${variants}:${extra}`;
  const source: object = extension ?? schema;
  let panes = derived.get(source);
  if (panes === undefined) {
    panes = new Map();
    derived.set(source, panes);
  }
  const known = panes.get(key);
  if (known !== undefined) return known;

  const entries: PaneRow[] = [];
  for (const field of fieldRows(schema, component)) {
    const draw = extension?.drawers?.[field.key];
    // A drawer's rows stand for the field's own, so they tune as it does.
    const drawn = draw === undefined ? null : draw(field.own, component).map((row) => tuned(row, field.tunable));
    const own = drawn ?? (field.own === null ? [] : [field.own]);
    const rows = [...own, ...field.nested, ...(extension?.after?.[field.key] ?? [])];
    if (field.separatorBefore && rows.length > 0) entries.push({ kind: 'separator' });
    entries.push(...rows);
  }
  const pane = { key, entries };
  panes.set(key, pane);
  return pane;
}
