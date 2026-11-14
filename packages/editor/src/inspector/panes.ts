import {
  conditionHolds,
  type ComponentDoc,
  type ComponentHost,
  type ComponentTypeId,
  type EntityId,
  type Schema,
  type SchemaField,
} from '@three-studio/core';
import type { EditorRegistries } from '../registries';
import {
  assetSlot,
  isGeometrySlot,
  type ComponentPane,
  type FieldSpec,
  type GeometrySlotSpec,
  type PaneEntry,
} from './fields';

/*
 * The pane a component type shows in the Inspector.
 *
 * Derived from the type's schema where it has one: the fields are already
 * written there, in the pane's order, each with its label, its range and the
 * condition its row is shown under. A pane written beside them would be the
 * second list a schema exists to remove, and the two would drift as the
 * interface and the pane did. A type still written by hand registers its pane.
 */

/** What a pane is looked up in: the types, and the panes written by hand. */
type Panes = Pick<EditorRegistries, 'components' | 'panes'>;

/** The panes derived so far, by schema: a schema is a constant, so its pane is made once. */
const derived = new WeakMap<Schema, ComponentPane>();

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

/**
 * One field as the row that edits it; `null` for a kind with no row derived
 * yet. Only the kinds a flat type holds are drawn here, and no type this build
 * registers holds another.
 */
function rowOf(key: string, field: SchemaField): FieldSpec | null {
  const path = [key];
  const { label } = field;
  switch (field.type) {
    case 'number':
      return { path, label, type: 'number', ...bounds(field) };
    case 'vec3':
      return { path, label, type: 'vec3', ...bounds(field) };
    case 'enum':
      return { path, label, type: 'enum', options: field.options };
    case 'asset':
      return assetSlot(path, label, field.kind);
    case 'boolean':
    case 'color':
      // Nothing to declare: the control is built from the value, a checkbox
      // for a boolean and a picker for `#rrggbb`.
      return { path, label };
    case 'string':
    case 'vec2':
    case 'entity':
    case 'object':
    case 'union':
    case 'custom':
      return null;
  }
}

/** A type's pane, from its fields: a row each, in their order, a rule where one asks for it. */
export function derivePane(id: ComponentTypeId, schema: Schema): ComponentPane {
  const fields: PaneEntry[] = [];
  for (const [key, field] of Object.entries(schema)) {
    const row = rowOf(key, field);
    if (row === null) continue;
    if (field.separatorBefore) fields.push({ kind: 'separator' });
    const condition = field.shownWhen;
    fields.push(
      condition === undefined
        ? row
        : { ...row, visibleWhen: (component) => conditionHolds(condition, Reflect.get(component, condition.field)) },
    );
  }
  return { id, fields };
}

/**
 * The pane of a type: the one registered for it, else the one its schema
 * gives, else none — a type that is not registered, or says nothing of itself.
 */
export function paneFor(registries: Panes, type: ComponentTypeId): ComponentPane | undefined {
  const written = registries.panes.get(type);
  if (written !== undefined) return written;
  const schema = registries.components.get(type)?.schema;
  if (schema === undefined) return undefined;
  let pane = derived.get(schema);
  if (pane === undefined) {
    pane = derivePane(type, schema);
    derived.set(schema, pane);
  }
  return pane;
}

/**
 * The rows a component's pane would offer, and the identity of that list.
 *
 * Two entries are not fixed by the component's type — see the facets on
 * `ComponentPane`. That is what `key` is for; everything else about the shape
 * is `visibleWhen`, and `shapeOf` reads it.
 */
export function paneEntriesFor(
  registries: Panes,
  component: ComponentDoc,
): { key: string; entries: readonly Exclude<PaneEntry, GeometrySlotSpec>[] } {
  const pane = paneFor(registries, component.type);
  if (pane === undefined) return { key: component.type, entries: [] };
  // The geometry slot expands in place, so a type that never declares one — all
  // but `mesh`, `collider` and `joint` — is unaffected.
  const entries: Exclude<PaneEntry, GeometrySlotSpec>[] = pane.fields.flatMap((entry) =>
    isGeometrySlot(entry) ? [...(pane.geometryFields?.(component) ?? [])] : [entry],
  );
  entries.push(...(pane.extraFields?.(component) ?? []));

  return { key: pane.paneKey?.(component) ?? component.type, entries };
}

/**
 * The types an entity holds a component of that this build does not define,
 * by name. The Inspector says so in their place: it cannot show what it cannot
 * read, and showing nothing would hide that the entity carries them at all.
 */
export function unknownTypesOn(host: Required<ComponentHost>, entityId: EntityId): string[] {
  return [...host.unknownComponents]
    .filter(([, table]) => table.has(entityId))
    .map(([type]) => type)
    .sort();
}
