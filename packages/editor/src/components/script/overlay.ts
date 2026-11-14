import type { EntityMarker, EntityOverlay } from '../registry';

/** A script draws nothing of its own; what it moves is somebody else's object. */
const drawsGeometry = false;

/**
 * No marker. A script is almost always attached to something already visible,
 * and one on a bare entity is scaffolding the hierarchy names better.
 */
const marker: EntityMarker | null = null;

const helper = null;

export const overlay: EntityOverlay = { id: 'script', drawsGeometry, marker, helper };
