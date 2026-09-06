import type { ComponentBase } from '../../scene/primitives';

/** First person, third person, or a free fly with no gravity. */
export type PlayerControllerMode = 'fps' | 'tps' | 'fly';

export const PLAYER_CONTROLLER_MODE_LABELS: Record<PlayerControllerMode, string> = {
  fps: 'FPS',
  tps: 'TPS',
  fly: 'Fly',
};

export interface PlayerControllerComponent extends ComponentBase {
  type: 'playerController';
  mode: PlayerControllerMode;
  moveSpeed: number;
  sprintMultiplier: number;
  jumpHeight: number;
  mouseSensitivity: number;
  /** Camera height above the entity origin in FPS mode. */
  eyeHeight: number;
  /** Camera distance behind the character in TPS mode. */
  cameraDistance: number;
}
