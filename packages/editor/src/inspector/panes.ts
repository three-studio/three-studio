import type { ComponentDoc, ComponentHost, EntityId } from '@three-studio/core';
import type { EditorRegistries } from '../registries';
import { derivedPane, type PaneRows } from './derivePane';

/*
 * The pane a component type shows in the Inspector: derived from the type's
 * schema, with what the type's editor part adds (`PaneExtension`).
 */

/** What a pane is looked up in: the types, and what their editor parts registered. */
type Panes = Pick<EditorRegistries, 'components' | 'panes'>;

/**
 * The rows a component's pane offers, and the identity of that list. None for
 * a type this window has not registered.
 */
export function paneEntriesFor(registries: Panes, component: ComponentDoc): PaneRows {
  const schema = registries.components.get(component.type)?.schema;
  if (schema === undefined) return { key: component.type, entries: [] };
  return derivedPane(component.type, schema, registries.panes.get(component.type), component);
}

/**
 * The types an entity holds a component of that this build does not define,
 * by name. The Inspector says so in their place: it cannot show what it cannot
 * read, and showing nothing would hide that the entity carries them at all.
 */
export function unknownTypesOn(host: Required<ComponentHost>, entityId: EntityId): string[] {
  return [...host.unknownComponents]
    .filter(([, { components }]) => components.has(entityId))
    .map(([type]) => type)
    .sort();
}
