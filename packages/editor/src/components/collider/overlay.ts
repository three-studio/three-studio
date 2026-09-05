import type { EntityMarker } from '../registry';

/** The shape physics uses is not the shape the author sees. */
export const drawsGeometry = false;

/**
 * No marker. A collider is on something already drawn, and the annotation worth
 * having for it is an outline of the shape itself — which nothing draws yet.
 */
export const marker: EntityMarker | null = null;

export const helper = null;
