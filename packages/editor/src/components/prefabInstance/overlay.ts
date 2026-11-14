import type { EntityMarker, EntityOverlay } from '../registry';

/**
 * The instance itself draws nothing — `expandPrefabs` turns its contents into
 * real entities, and those draw whatever they carry.
 */
const drawsGeometry = false;

/**
 * No marker. An instance that expanded into something is already clickable
 * through what it expanded into, and one that did not is a missing asset, which
 * the hierarchy says better than a dot in space.
 */
const marker: EntityMarker | null = null;

const helper = null;

export const overlay: EntityOverlay = { id: 'prefabInstance', drawsGeometry, marker, helper };
