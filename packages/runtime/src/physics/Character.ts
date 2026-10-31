import type RAPIER from '@dimforge/rapier3d-compat';
import type { CharacterController, CharacterSettings, QuatLike, Vec3Like } from './PhysicsApi';

/**
 * A kinematic character, moved by Rapier's character controller.
 *
 * A tool the world lends a behaviour. The gameplay numbers — how steep, how
 * high a step, how far the ground holds — are the caller's settings; what lives
 * here is how Rapier's controller behaves, which is true for any character.
 * Three of those behaviours cost the player dearly before anyone knew of them,
 * two its jump's height and one every kinematic floor, and they are handled
 * below, once, for every character.
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
    this.finishAlongTheFloor(movement);

    const current = this.body.translation();
    this.body.setNextKinematicTranslation({
      x: current.x + movement.x,
      y: current.y + movement.y,
      z: current.z + movement.z,
    });
    this.body.setNextKinematicRotation(rotation);
    return movement;
  }

  /**
   * Adds to `movement` the part of the move the floor itself stopped.
   *
   * A character rests a hair inside its offset, so a sweep along the floor
   * starts touching it. Rapier lifts such a sweep by a nudge along the floor's
   * normal, and on a kinematic body its moving-platform friction then sets the
   * movement's normal part back to the platform's own: the nudge is gone, a
   * sweep whose normal leans the slightest bit against it is stopped at once,
   * and after twenty of those the controller gives up. Measured in Rapier 0.20
   * and 0.21: on a kinematic floor at rest a player walked 0.4 m of the 9 it
   * walked on a fixed one, and a platform moved at 2 m/s left it a quarter of
   * its travel behind.
   *
   * What the floor stopped is swept again from the nudge Rapier meant to give,
   * and the nudge is then taken back. Kept, it left the next tick's snap to
   * ground starting on the very edge of the offset, and that snap once sank the
   * player 14 cm into its platform.
   */
  private finishAlongTheFloor(movement: Vec3Like): void {
    const count = this.controller.numComputedCollisions();
    const last = count > 0 ? this.controller.computedCollision(count - 1) : null;
    // Stopped at once by a face it can stand on, not by a wall or a steep slope…
    if (!last || last.toi > 1e-6 || last.normal1.y < Math.cos(this.settings.maxSlope)) return;
    // …and moved along nothing after that stop.
    const applied = last.translationDeltaApplied;
    if (Math.abs(movement.x - applied.x) + Math.abs(movement.z - applied.z) > 1e-6) return;

    const { x, y, z } = last.translationDeltaRemaining;
    const n = last.normal1;
    const across = x * n.x + y * n.y + z * n.z;
    const along = { x: x - n.x * across, y: y - n.y * across, z: z - n.z * across };
    if (Math.hypot(along.x, along.y, along.z) < 1e-5) return;

    this.controller.computeColliderMovement(this.collider, {
      x: along.x + n.x * FLOOR_NUDGE,
      y: along.y + n.y * FLOOR_NUDGE,
      z: along.z + n.z * FLOOR_NUDGE,
    });
    const rest = this.controller.computedMovement();
    movement.x += rest.x - n.x * FLOOR_NUDGE;
    movement.y += rest.y - n.y * FLOOR_NUDGE;
    movement.z += rest.z - n.z * FLOOR_NUDGE;
  }
}

/**
 * How far above the floor a stopped move is swept again, in metres: enough for
 * the sweep to lean away from the floor by more than the stopped one leaned
 * into it, under a thousandth of a radian. At 10 m/s it leans away by 0.006.
 */
const FLOOR_NUDGE = 1e-3;
