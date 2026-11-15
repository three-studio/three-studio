import type { ComponentDoc } from '../../scene/schema';
import { colliderType } from '../collider';
import { createColliderShape, type ColliderComponent } from '../collider/schema';
import { defineComponent } from '../registry';
import { rigidbodyType } from '../rigidbody';
import { playerControllerSchema } from './schema';

/** A character the player drives: see `playerControllerSchema`. */
export const playerControllerType = defineComponent({
  id: 'playerController',
  label: 'Player Controller',
  version: 1,
  schema: playerControllerSchema,
  runtime: true,
  addable: true,
  // With no collider a player controller degrades to flying, so it brings
  // one, and a body: the bargain Unity makes when a CharacterController brings
  // its own capsule. The collider must be its own, since the character sweeps
  // that one: none elsewhere counts.
  requires: [
    { type: 'collider', create: playerCollider },
    // A character is moved by the controller, not by forces, so its body has
    // to be kinematic or physics would fight the input.
    { type: 'rigidbody', create: () => ({ ...rigidbodyType.create(), bodyType: 'kinematicPosition' }) },
  ],
});

/**
 * The collider a player stands in: the one guessed from a mesh or a model the
 * author can see, which is about the object on screen; with neither, a person,
 * 0.3 m wide and 1.70 m standing.
 *
 * Not the 1 m box a bare entity would otherwise get. That box made the default
 * player incoherent: centred on the origin, it put a 1.6 m eye at 2.1 m above
 * the floor on a character one metre tall, and nothing on screen said where the
 * extra half metre came from. 1.70 m standing is what `eyeHeight` is chosen
 * against.
 */
function playerCollider(siblings: readonly ComponentDoc[]): ColliderComponent {
  const collider = colliderType.createFor(siblings);
  if (siblings.some((sibling) => sibling.type === 'mesh' || sibling.type === 'model')) return collider;
  return { ...collider, shape: { ...createColliderShape('capsule'), radius: 0.3, height: 1.7 } };
}
