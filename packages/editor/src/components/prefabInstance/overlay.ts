import type { EntityMarker } from '../registry';

/**
 * The instance itself draws nothing — `expandPrefabs` turns its contents into
 * real entities, and those draw whatever they carry.
 */
export const drawsGeometry = false;

/**
 * No marker. An instance that expanded into something is already clickable
 * through what it expanded into, and one that did not is a missing asset, which
 * the hierarchy says better than a dot in space.
 */
export const marker: EntityMarker | null = null;

export const helper = null;
