import type RAPIER from '@dimforge/rapier3d-compat';
import type { CharacterController, CharacterSettings, QuatLike, Vec3Like } from './PhysicsApi';

/**
 * A kinematic character, moved by Rapier's character controller.
 *
 * A tool the world lends a behaviour. The gameplay numbers — how steep, how
 * high a step, how far the ground holds — are the caller's settings; what lives
 * here is how Rapier's controller behaves, which is true for any character. Two
 * of those behaviours each cost the player's jump its height before anyone knew
 * of them, and they are handled below, once, for every character.
 *
 * Built from Rapier's own objects, so this file needs nothing of the world's
 * and the two import no cycle.
 */
export class Character implements CharacterController {
  grounded = false;

  constructor(
    private readonly controller: RAPIER.KinematicCharacterController,
    private readonly body: RAPIER.RigidBody,
    private readonly collider: RAPIER.Collider,
    private readonly settings: CharacterSettings,
  ) {
    // Without autostep a character catches on every kerb and stair edge. The
    // `true` is the tool's, not a setting: a character steps onto a dynamic
    // body as onto anything else.
    controller.enableAutostep(settings.stepHeight, settings.stepWidth, true);
    controller.setMaxSlopeClimbAngle(settings.maxSlope);
    // Without snap-to-ground, walking down a slope becomes a series of hops.
    controller.enableSnapToGround(settings.snapToGround);
    // A character pushes the dynamic bodies it walks into, a ball rolling away
    // from the player's feet; without this it stops against them as against a wall.
    controller.setApplyImpulsesToDynamicBodies(true);
  }

  move(translation: Readonly<Vec3Like>, rotation: Readonly<QuatLike>): Readonly<Vec3Like> {
    // Snap-to-ground is what stops a character hopping down slopes, but it also
    // drags it straight back to the floor the instant it leaves, which turns a
    // jump into a stutter a few centimetres high. It has to be off while rising.
    if (translation.y > 0) this.controller.disableSnapToGround();
    else this.controller.enableSnapToGround(this.settings.snapToGround);

    this.controller.computeColliderMovement(this.collider, translation);

    // `&& translation.y <= 0`, and without it a jump is five centimetres high.
    // Rapier answers `computedGrounded()` from the contact it found while
    // solving, so on the tick a jump leaves the floor — still touching it when
    // the solve begins — it comes back true although the move went up. The
    // player then read "grounded" on the next tick, overwrote its jump with the
    // velocity it stands with, and the snap pulled it back down. Measured: a
    // 1.2 m jump reached 0.0497 m, one tick of its initial velocity. A rising
    // move is leaving the floor, which is what `grounded` is asked; landing
    // still reads true, the descent being under way long before the contact.
    this.grounded = this.controller.computedGrounded() && translation.y <= 0;

    // Rapier hands back a fresh object, which is the copy the API promises.
    const movement = this.controller.computedMovement();
    const current = this.body.translation();
    this.body.setNextKinematicTranslation({
      x: current.x + movement.x,
      y: current.y + movement.y,
      z: current.z + movement.z,
    });
    this.body.setNextKinematicRotation(rotation);
    return movement;
  }
}
