import type { EntityMarker } from '../registry';

/** A surface is a plane with a shader on it: geometry, and clickable as itself. */
export const drawsGeometry = true;

/** No marker: the surface is there to be clicked. */
export const marker: EntityMarker | null = null;

export const helper = null;
