import type { ComponentBase, Hex } from '../../scene/primitives';

export type LightKind =
  | 'ambient'
  | 'hemisphere'
  | 'directional'
  | 'point'
  | 'spot'
  | 'rectArea'
  | 'projector';

/**
 * What three carries on `light.shadow`, for the kinds that cast one.
 *
 * A sub-object rather than eight more fields on the light, for the reason
 * `MeshComponent.material` is one: they are read and written together, and the
 * migration merges them a level deeper in one place instead of eight.
 *
 * Every default is three's own, so filling this into a scene written before it
 * existed changes nothing on screen — which is the only way to add a field to a
 * persisted format without auditing every project that has one.
 */
export interface ShadowSettings {
  bias: number;
  normalBias: number;
  radius: number;
  blurSamples: number;
  near: number;
  far: number;
  /** Directional only: half-extent of the orthographic shadow camera. */
  orthoSize: number;
  /** Spot and projector only. */
  focus: number;
}

export interface LightComponent extends ComponentBase {
  type: 'light';
  kind: LightKind;
  color: Hex;
  intensity: number;
  /** Hemisphere only. */
  groundColor: Hex;
  /** Point, spot and projector only. `0` means no falloff limit. */
  distance: number;
  decay: number;
  /** Spot and projector only, radians. */
  angle: number;
  penumbra: number;
  /** Rect area only, metres. The rectangle emits from its local -Z face. */
  width: number;
  height: number;
  /** Projector only: the texture it throws. */
  mapId: string | null;
  /** Projector only. `0` means take the aspect from the texture. */
  aspect: number;
  castShadow: boolean;
  shadow: ShadowSettings;
}
