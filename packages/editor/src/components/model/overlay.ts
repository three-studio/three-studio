import type { EntityMarker } from '../registry';

/** An imported file draws whatever it contains, and it is clickable as itself. */
export const drawsGeometry = true;

/** No marker: there is geometry there to click, once the load has landed. */
export const marker: EntityMarker | null = null;

export const helper = null;
