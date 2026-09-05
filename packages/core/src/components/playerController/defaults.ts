import { createId } from '../../ids';
import type { PlayerControllerComponent } from './schema';

export function createPlayerController(): PlayerControllerComponent {
  return {
    id: createId(),
    type: 'playerController',
    mode: 'fps',
    moveSpeed: 6,
    sprintMultiplier: 1.8,
    jumpHeight: 1.2,
    mouseSensitivity: 0.0022,
    eyeHeight: 1.7,
    cameraDistance: 5,
  };
}
