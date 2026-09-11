import type { AddMenuGroup } from '../registry';

/**
 * Not on the Add menu: an instance arrives by placing a prefab from the
 * project panel, and an empty one would point at no asset at all.
 */
export const menu: AddMenuGroup | null = null;
