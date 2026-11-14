import { Registry, type ComponentTypeId } from '@three-studio/core';
import { createRuntimeRegistries, type RuntimeRegistries } from '@three-studio/runtime';
import type { AddMenuGroup, EntityOverlay, HierarchyIcon } from './components/registry';
import type { ComponentPane, PaneExtension } from './inspector/fields';

/**
 * What the editor knows by registration, on top of what the runtime does: what
 * each component type shows in the Inspector, offers the Add menu, draws in the
 * viewport and gives its row in the Hierarchy.
 *
 * Each was a table written out type by type — `COMPONENT_PANES`, `ADD_MENUS`,
 * `OVERLAYS`, `ICON_PRIORITY` — total over a closed union, so that a type
 * could only be added by editing all four inside this package. A registry is
 * filled from outside: a type's editor part registers what it has, and a type
 * that has nothing to say in one of them registers nothing there.
 *
 * In a file that imports no type's part, and that matters: the viewport, the
 * commands and the stores read these registries, and the parts are written
 * with all three. The activation that lists the parts is `activate.ts`.
 */
export interface EditorRegistries extends RuntimeRegistries {
  /**
   * What a type adds to the pane derived from its schema; or, for a type not
   * yet written as one, its whole pane, written by hand.
   */
  readonly panes: Registry<ComponentTypeId, ComponentPane | PaneExtension>;
  readonly addMenu: Registry<ComponentTypeId, AddMenuGroup>;
  readonly overlays: Registry<ComponentTypeId, EntityOverlay>;
  readonly icons: Registry<ComponentTypeId, HierarchyIcon>;
}

/** The editor's registries, empty. A root fills them by activating, layer by layer. */
export function createEditorRegistries(): EditorRegistries {
  return {
    ...createRuntimeRegistries(),
    panes: new Registry('pane'),
    addMenu: new Registry('Add menu group'),
    overlays: new Registry('viewport overlay'),
    icons: new Registry('Hierarchy icon'),
  };
}
