import type { EntityMarker, EntityOverlay } from '../registry';

/** A surface is a plane with a shader on it: geometry, and clickable as itself. */
const drawsGeometry = true;

/** No marker: the surface is there to be clicked. */
const marker: EntityMarker | null = null;

const helper = null;

export const overlay: EntityOverlay = { id: 'water', drawsGeometry, marker, helper };
