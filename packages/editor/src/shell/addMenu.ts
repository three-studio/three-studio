import { createEntity, type ComponentTypeId, type CoreRegistries, type EntityTemplate, type Registry } from '@three-studio/core';
import type { AddMenuEntry, AddMenuGroup } from '../components/registry';
import { addEntityInView, canAddInView } from '../commands/placeEntity';
import type { EditorContext } from '../commands/registry';
import { STOP_TO_EDIT } from '../state/sceneLock';
import type { MenuEntry, MenuItem } from '../ui/Menu';
import { commandEntry } from './commandEntry';

/*
 * What "Add" can create, as the menu bar's Add menu lists it.
 *
 * Grouped into submenus rather than one flat list: the primitives alone make a
 * list long enough to run off the bottom of a short window, and the three.js
 * editor, Unity and Blender all group them this way.
 */

/**
 * Every entry places into the scene, so every one is greyed while the game
 * runs, saying why. A submenu's heading stays live: it only opens rows that say
 * it themselves.
 */
const placing = (): Pick<MenuItem, 'disabled' | 'detail'> =>
  canAddInView() ? {} : { disabled: true, detail: STOP_TO_EDIT };

/** One thing a slice offers, as a menu entry that places it. */
const offer = (registries: CoreRegistries, entry: AddMenuEntry): MenuEntry =>
  entry === null
    ? null
    : { label: entry.label, ...placing(), onSelect: () => addEntityInView(registries, entry.create()) };

/**
 * The submenus, in the order they declared, with the types that named the same
 * one merged into it.
 *
 * Two types share a group by naming it — an audio source and an audio listener
 * both say "Audio" — rather than by anyone listing them together. Within a
 * group the entries follow the order the types registered in, which is what
 * puts the source above the listener.
 */
export function addMenuGroups(
  addMenu: Registry<ComponentTypeId, AddMenuGroup>,
): readonly { label: string; entries: readonly AddMenuEntry[] }[] {
  const merged = new Map<string, { order: number; entries: AddMenuEntry[] }>();
  for (const group of addMenu.values()) {
    const found = merged.get(group.label);
    if (found) found.entries.push(...group.entries);
    else merged.set(group.label, { order: group.order, entries: [...group.entries] });
  }
  return [...merged]
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([label, { entries }]) => ({ label, entries }));
}

/*
 * Where the new object lands is `addEntityInView`'s business, not the menu's.
 * There used to be a `parentId` parameter here, threaded through every entry and
 * passed by nobody: the one caller took the default. The selection is read at
 * the moment the entry is picked instead, which is also the moment it is true.
 *
 * `context` is what Group is asked and run against: the selection as the bar
 * read it for this render. Its registries are what every entry places through,
 * and `addMenu` is what the registered types offer.
 */
export function buildAddMenu(context: EditorContext, addMenu: Registry<ComponentTypeId, AddMenuGroup>): MenuEntry[] {
  const { registries } = context;
  const add = (factory: () => EntityTemplate) => () => addEntityInView(registries, factory());

  return [
    // three calls this a Group; Unity calls it an Empty. Both names are in the
    // label because someone who wants a group looks for the word "group", and
    // one that only said "Empty" reads as "there is no group in this editor".
    { label: 'Empty (Group)', ...placing(), onSelect: add(() => createEntity('Empty')) },
    // The other half, and the one that is actually asked for: an empty is
    // trivial to make, and dragging five objects into it one at a time is not.
    //
    // Through the registry. This entry once asked
    // `selection.length === 0` while Cmd+G asked `can('group')`, so a locked
    // object was refused by the shortcut and grouped by the menu.
    commandEntry('group', context),
    null,
    ...addMenuGroups(addMenu).map((group) => ({
      label: group.label,
      submenu: group.entries.map((entry) => offer(registries, entry)),
    })),
  ];
}
