import type { Disposable } from '@three-studio/core';
import type { EntityChannel } from '../world/channel';
import type { PhysicsApi, Touch } from './PhysicsApi';
import type { DebugLines, PhysicsWorld } from './PhysicsWorld';

/** What physics provides a world: its solver, and the channel it publishes collisions on. */
interface Provided {
  readonly physics: PhysicsWorld;
  readonly collisions: EntityChannel<Touch>;
}

/*
 * Each world's physics, keyed by the world: as `audioOf` is, and keyed by any
 * object for the same reason — the world still builds the behaviours' context,
 * which hands physics to the behaviours, and wires the listening ones to the
 * collision channel, and so imports this file.
 */
const provided = new WeakMap<object, Provided>();

/**
 * Physics as the behaviours see it: bodies, joints, queries, characters.
 * `null` for a world that runs none — a test that leaves it out.
 */
export function physicsOf(world: object): PhysicsApi | null {
  return provided.get(world)?.physics ?? null;
}

/**
 * Rapier's debug view as of the last tick, for a host to draw over the game;
 * `null` with no physics. Not on `PhysicsApi`, which every behaviour and script
 * is handed: what the solver holds is the host's to show.
 */
export function physicsDebugLines(world: object): DebugLines | null {
  return provided.get(world)?.physics.debugLines() ?? null;
}

/** Where a world's collisions are heard: listened on by entity, told after the tick they happen in. */
export function collisionsOf(world: object): EntityChannel<Touch> | null {
  return provided.get(world)?.collisions ?? null;
}

/** Files physics as `world`'s until the result is disposed: the physics subsystem's, while it lives. */
export function providePhysics(world: object, physics: PhysicsWorld, collisions: EntityChannel<Touch>): Disposable {
  provided.set(world, { physics, collisions });
  return { dispose: () => void provided.delete(world) };
}
