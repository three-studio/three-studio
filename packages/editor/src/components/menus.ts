/*
 * What every component type offers the Add menu, assembled.
 *
 * Total, for the reason `panes.ts` gives: the six types that offer nothing say
 * `null`, where being absent from a list was only ever an omission nobody could
 * tell from a choice.
 */
import type { ComponentType } from '@three-studio/core';
import { menu as audioListener } from './audioListener/menu';
import { menu as audioSource } from './audioSource/menu';
import { menu as camera } from './camera/menu';
import { menu as collider } from './collider/menu';
import { menu as light } from './light/menu';
import { menu as mesh } from './mesh/menu';
import { menu as model } from './model/menu';
import { menu as playerController } from './playerController/menu';
import { menu as prefabInstance } from './prefabInstance/menu';
import type { AddMenuGroup } from './registry';
import { menu as rigidbody } from './rigidbody/menu';
import { menu as script } from './script/menu';
import { menu as water } from './water/menu';

const ADD_MENUS: Record<ComponentType, AddMenuGroup | null> = {
  mesh,
  model,
  water,
  light,
  camera,
  rigidbody,
  collider,
  audioSource,
  audioListener,
  script,
  prefabInstance,
  playerController,
};

/**
 * The submenus, in the order they declared, with the types that named the same
 * one merged into it.
 *
 * Two types share a group by naming it — an audio source and an audio listener
 * both say "Audio" — rather than by anyone listing them together. Within a
 * group the entries follow the union's order, which is what put the source
 * above the listener before this was assembled at all.
 */
export function addMenuGroups(): readonly AddMenuGroup[] {
  const merged = new Map<string, { order: number; entries: AddMenuGroup['entries'][] }>();
  for (const group of Object.values(ADD_MENUS)) {
    if (group === null) continue;
    const found = merged.get(group.label);
    if (found) found.entries.push(group.entries);
    else merged.set(group.label, { order: group.order, entries: [group.entries] });
  }

  return [...merged]
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([label, { order, entries }]) => ({ label, order, entries: entries.flat() }));
}
