import type { AddMenuGroup } from '../registry';

/**
 * Not on the Add menu: a model arrives by dropping a file, and an empty one
 * would point at no asset at all. That is `addable: false` in the core
 * registry, said again here for the menu that creates entities.
 */
export const menu: AddMenuGroup | null = null;
