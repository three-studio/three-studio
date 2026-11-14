import type { EntityMarker, EntityOverlay } from '../registry';

/** An imported file draws whatever it contains, and it is clickable as itself. */
const drawsGeometry = true;

/** No marker: there is geometry there to click, once the load has landed. */
const marker: EntityMarker | null = null;

const helper = null;

export const overlay: EntityOverlay = { id: 'model', drawsGeometry, marker, helper };
