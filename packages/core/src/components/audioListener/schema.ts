import type { Infer, Schema } from '../../fieldSchema';
import type { Component } from '../../scene/primitives';

/** What the game hears through, as its fields. */
export const audioListenerSchema = {
  /* The gain on everything the game plays, from 0 (silent) to 1. */
  masterVolume: { type: 'number', label: 'Master volume', default: 1, min: 0, max: 1, step: 0.01 },
} as const satisfies Schema;

export type AudioListenerComponent = Component<'audioListener', Infer<typeof audioListenerSchema>>;
