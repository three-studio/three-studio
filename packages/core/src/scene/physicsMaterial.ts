import { conform, oneOf } from '../conform';

/*
 * How a surface grips and bounces. Beside `material.ts` and shared for the same
 * reason: a collider carries one inline, and a physics material asset carries
 * the same thing in a file of its own.
 */

/**
 * How two touching colliders' values make one. When the two name different
 * rules, the later one here wins — Rapier's order, and Unity's.
 */
export type CombineRule = 'average' | 'min' | 'multiply' | 'max';

export const COMBINE_RULE_LABELS: Record<CombineRule, string> = {
  average: 'Average',
  min: 'Minimum',
  multiply: 'Multiply',
  max: 'Maximum',
};

export interface PhysicsMaterialDef {
  /** 0 slides like ice; 1 and over grips. */
  friction: number;
  /** How much speed a bounce gives back: 0 none, 1 all of it. */
  restitution: number;
  frictionCombine: CombineRule;
  restitutionCombine: CombineRule;
}

/** Average is Rapier's default and Unity's. */
export function createPhysicsMaterial(): PhysicsMaterialDef {
  return { friction: 0.7, restitution: 0, frictionCombine: 'average', restitutionCombine: 'average' };
}

/**
 * A stored physics material, each value kept where it fits and the factory's
 * where it does not; a rule this build does not know reads as the factory's.
 */
export function conformPhysicsMaterial(value: unknown): PhysicsMaterialDef {
  const model = createPhysicsMaterial();
  const kept = conform(value, model);
  const rule = (stored: unknown, fallback: CombineRule) => oneOf(stored, COMBINE_RULE_LABELS, fallback);
  return {
    ...kept,
    frictionCombine: rule(kept.frictionCombine, model.frictionCombine),
    restitutionCombine: rule(kept.restitutionCombine, model.restitutionCombine),
  };
}

/**
 * The physics material asset `materialId` names, or `null` when `library` holds
 * none under it. Own keys only: an id is read off a file, and
 * `library['constructor']` would answer with `Object`.
 */
export function linkedPhysicsMaterial(
  materialId: string | null,
  library: Readonly<Record<string, PhysicsMaterialDef>>,
): PhysicsMaterialDef | null {
  return materialId !== null && Object.hasOwn(library, materialId) ? library[materialId]! : null;
}
