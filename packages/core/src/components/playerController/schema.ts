import type { ComponentBase } from '../../scene/primitives';

export interface PlayerControllerComponent extends ComponentBase {
  type: 'playerController';
  mode: 'fps' | 'tps' | 'fly';
  moveSpeed: number;
  sprintMultiplier: number;
  jumpHeight: number;
  mouseSensitivity: number;
  /** Camera height above the entity origin in FPS mode. */
  eyeHeight: number;
  /** Camera distance behind the character in TPS mode. */
  cameraDistance: number;
}
