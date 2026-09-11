import type { AddMenuGroup } from '../registry';

/**
 * Not on the Add menu, which creates entities: a script is attached to one from
 * "Add Component" in the inspector, which the core registry's `addable` drives.
 */
export const menu: AddMenuGroup | null = null;
