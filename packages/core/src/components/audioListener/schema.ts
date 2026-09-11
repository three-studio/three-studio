import type { ComponentBase } from '../../scene/primitives';

/**
 * The ears. Exactly one should be active — normally on the play camera or the
 * player — and the runtime warns when a scene has none or several.
 */
export interface AudioListenerComponent extends ComponentBase {
  type: 'audioListener';
  masterVolume: number;
}
