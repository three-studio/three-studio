import type { AddMenuGroup } from '../registry';

/**
 * Not on the Add menu, which creates entities: a collider is attached to one
 * from "Add Component" in the inspector, where it guesses its shape from the
 * mesh it joins.
 */
export const menu: AddMenuGroup | null = null;
