import { conform } from '../conform';

/*
 * How a surface grips and bounces. Beside `material.ts` and shared for the same
 * reason: a collider carries one inline, and a physics material asset will
 * carry the same thing in a file of its own.
 */

export interface PhysicsMaterialDef {
  /** 0 slides like ice; 1 and over grips. */
  friction: number;
  /** How much speed a bounce gives back: 0 none, 1 all of it. */
  restitution: number;
}

export function createPhysicsMaterial(): PhysicsMaterialDef {
  return { friction: 0.7, restitution: 0 };
}

/** A stored physics material, each value kept where it fits and the factory's where it does not. */
export function conformPhysicsMaterial(value: unknown): PhysicsMaterialDef {
  return conform(value, createPhysicsMaterial());
}
