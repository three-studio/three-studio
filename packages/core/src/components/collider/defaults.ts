import { createId } from '../../ids';
import type { ColliderComponent } from './schema';

export function createCollider(): ColliderComponent {
  return {
    id: createId(),
    type: 'collider',
    shape: 'box',
    size: [0.5, 0.5, 0.5],
    radius: 0.5,
    halfHeight: 0.5,
    friction: 0.7,
    restitution: 0,
    isSensor: false,
  };
}
