import { conform } from '../conform';
import { planFields, type Infer, type Schema } from '../fieldSchema';
import type { AssetId } from '../ids';

/*
 * How a surface grips and bounces. Beside `material.ts` and shared for the same
 * reason: a collider carries one inline, and a physics material asset carries
 * the same thing in a file of its own.
 */

/**
 * How two touching colliders' values make one. When the two name different
 * rules, the later one here wins — Rapier's order, and Unity's. Average is
 * Rapier's default and Unity's.
 */
const combine = (label: string) =>
  ({
    type: 'enum',
    label,
    default: 'average',
    options: [
      { value: 'average', label: 'Average' },
      { value: 'min', label: 'Minimum' },
      { value: 'multiply', label: 'Multiply' },
      { value: 'max', label: 'Maximum' },
    ],
  }) as const;

/** A physics material, as its fields. The order is the pane's. */
export const physicsMaterialFields = {
  /* 0 slides like ice; 1 and over grips. */
  friction: { type: 'number', label: 'Friction', default: 0.7, min: 0, max: 2, step: 0.01 },
  frictionCombine: combine('Friction combine'),
  /* How much speed a bounce gives back: 0 none, 1 all of it. */
  restitution: { type: 'number', label: 'Bounciness', default: 0, min: 0, max: 1, step: 0.01 },
  restitutionCombine: combine('Bounce combine'),
} as const satisfies Schema;

export type PhysicsMaterialDef = Infer<typeof physicsMaterialFields>;
export type CombineRule = PhysicsMaterialDef['frictionCombine'];

const physicsMaterialPlan = planFields(physicsMaterialFields);

/** A physics material at its defaults. */
export function createPhysicsMaterial(): PhysicsMaterialDef {
  return { ...physicsMaterialPlan.defaults };
}

/**
 * A physics material sent by a window, each value kept where it fits and the
 * factory's where it does not; a rule this build does not know reads as the
 * factory's, one of the field's own options.
 */
export function conformPhysicsMaterial(value: unknown): PhysicsMaterialDef {
  const model = createPhysicsMaterial();
  const kept = conform(value, model);
  const rule = (stored: unknown, fallback: CombineRule): CombineRule =>
    physicsMaterialFields.frictionCombine.options.find((option) => option.value === stored)?.value ?? fallback;
  return {
    ...kept,
    frictionCombine: rule(kept.frictionCombine, model.frictionCombine),
    restitutionCombine: rule(kept.restitutionCombine, model.restitutionCombine),
  };
}

/**
 * The physics material asset `materialId` names, or `null` when `library` holds
 * none under it.
 */
export function linkedPhysicsMaterial(
  materialId: AssetId | null,
  library: ReadonlyMap<AssetId, PhysicsMaterialDef>,
): PhysicsMaterialDef | null {
  return materialId === null ? null : library.get(materialId) ?? null;
}
