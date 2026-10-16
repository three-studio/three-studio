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
    // An adult's eye, measured from the floor — which is what the field means
    // now. It pairs with the 1.70 m capsule `addComponentWithDependencies`
    // gives a new player, so the two defaults compose into a person instead of
    // needing a formula to reconcile.
    eyeHeight: 1.6,
    cameraDistance: 5,
    // The literal `PlayerController` used to build its camera with, so a
    // component filled from this factory behaves exactly as it did.
    fov: 70,
    // Nothing is drawn until someone touches the screen, so a desktop build
    // defaults to exactly what it has always been.
    touchControls: 'auto',
    touchLookSpeed: 2.5,
  };
}
