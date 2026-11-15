import type { EntityMarker, EntityOverlay } from '../registry';

/** The primitive itself. Geometry, and the thing an author clicks. */
const drawsGeometry = true;

/** No marker: a marker on top of a cube is an icon nobody needs. */
const marker: EntityMarker | null = null;

const helper = null;

export const overlay: EntityOverlay = { id: 'mesh', drawsGeometry, marker, helper };
