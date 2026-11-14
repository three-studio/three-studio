import type { ComponentDoc, ComponentHost, ComponentTypeId, EntityId } from '@three-studio/core';
import type { EditorRegistries } from '../registries';
import { derivedPane, type PaneRows } from './derivePane';
import { isGeometrySlot, type ComponentPane, type PaneExtension, type PaneRow } from './fields';

/*
 * The pane a component type shows in the Inspector.
 *
 * Derived from the type's schema where it has one, with what the type's editor
 * part adds (`PaneExtension`). A type still written by hand registers its whole
 * pane instead.
 */

/** What a pane is looked up in: the types, and what their editor parts registered. */
type Panes = Pick<EditorRegistries, 'components' | 'panes'>;

/** Whether a registered pane is one written by hand, by the one property only it has. */
function isWrittenPane(pane: ComponentPane | PaneExtension): pane is ComponentPane {
  return 'fields' in pane;
}

/** The pane written by hand for a type, if one is registered: what a type not yet written as a schema shows. */
export function paneFor(registries: Panes, type: ComponentTypeId): ComponentPane | undefined {
  const registered = registries.panes.get(type);
  return registered !== undefined && isWrittenPane(registered) ? registered : undefined;
}

/**
 * The rows a component's pane offers, the identity of that list, and whether
 * they tune the running game.
 *
 * A type written as a schema gets its derived pane, extended by what its
 * editor part registered. A pane written by hand has two entries its type does
 * not fix — see the facets on `ComponentPane` — and its key says so; everything
 * else about its shape is `visibleWhen`, which `shapeOf` reads.
 */
export function paneEntriesFor(registries: Panes, component: ComponentDoc): PaneRows {
  const registered = registries.panes.get(component.type);
  if (registered !== undefined && isWrittenPane(registered)) return writtenRows(registered, component);
  const schema = registries.components.get(component.type)?.schema;
  if (schema === undefined) return { key: component.type, entries: [], live: false };
  return derivedPane(component.type, schema, registered, component);
}

function writtenRows(pane: ComponentPane, component: ComponentDoc): PaneRows {
  // The geometry slot expands in place, so a type that never declares one — all
  // but `mesh`, `collider` and `joint` — is unaffected.
  const entries: PaneRow[] = pane.fields.flatMap((entry) =>
    isGeometrySlot(entry) ? [...(pane.geometryFields?.(component) ?? [])] : [entry],
  );
  entries.push(...(pane.extraFields?.(component) ?? []));
  return { key: pane.paneKey?.(component) ?? component.type, entries, live: pane.live === true };
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
