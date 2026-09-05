import { createId } from '../../ids';
import type { RigidBodyComponent } from './schema';

export function createRigidBody(): RigidBodyComponent {
  return {
    id: createId(),
    type: 'rigidbody',
    bodyType: 'dynamic',
    mass: 1,
    linearDamping: 0,
    angularDamping: 0.05,
    gravityScale: 1,
    ccd: false,
  };
}
