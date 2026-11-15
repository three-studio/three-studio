import type { EntityMarker, EntityOverlay } from '../registry';

/** An ear draws nothing; it only hears. */
const drawsGeometry = false;

/**
 * The same green and the same size as an audio source, because the two read as
 * one family and an author scanning a scene wants "sound is here", not which of
 * the two it is. Ranked below the source only because a scene has many sources
 * and one ear.
 */
const marker: EntityMarker = { color: 0x6ee7a8, pixels: 9, priority: 4 };

/** Nothing to annotate: an ear has no radius, no cone and no direction. */
const helper = null;

export const overlay: EntityOverlay = { id: 'audioListener', drawsGeometry, marker, helper };
