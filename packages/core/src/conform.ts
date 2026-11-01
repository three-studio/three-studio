/*
 * Reading a value against the factory of its type.
 *
 * A leaf: it imports nothing, so any module may read its data through it. These
 * lived in `guards.ts`, which imports the project, asset and preference schemas
 * to name its four payloads, and a component's `fill` reaching for `conform`
 * there closed a cycle through `assets/schema.ts` and back into the scene.
 */

/** An object that is neither `null` nor an array: what a record that arrived from elsewhere has to be. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Numbers that can be written and read back. `NaN` serialises as `null`. */
function isUsableNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Whether a value may stand in for the one beside it in the model.
 *
 * `typeof`, with two rules that `typeof` alone cannot give:
 *
 *  - **A model of `null` accepts `null` or a string.** Every nullable field in
 *    the values that cross this boundary is an asset id or a scene id, and a
 *    factory has to put *something* there. It is the one place the model cannot
 *    speak for itself, and it is written down rather than guessed at each site.
 *  - **An array matches an array of the same length**, element by element. The
 *    arrays here are fixed-length tuples — a `Vec2`, a `Vec3`, an RGB triple —
 *    so a different length is a different type, not a shorter list.
 */
function fits(value: unknown, model: unknown): boolean {
  if (model === null) return value === null || typeof value === 'string';
  if (Array.isArray(model)) {
    return Array.isArray(value) && value.length === model.length
      && value.every((item, index) => fits(item, model[index]));
  }
  if (typeof model === 'number') return isUsableNumber(value);
  if (typeof model === 'object') return typeof value === 'object' && value !== null;
  return typeof value === typeof model;
}

/**
 * A value rebuilt against a model of the same shape.
 *
 * Each field of the model is taken from `value` when it is there and fits, and
 * from the model when it is not. A field the model does not name is **dropped**,
 * and that is the one place this parts company with `fillComponent`, which
 * keeps what it does not recognise. The difference is who wrote the data: a
 * scene on disk was written by some version of this editor and its unknown
 * fields are somebody's work, while this arrives from a renderer that shipped
 * in the same binary as the model. There is nothing here that a newer version
 * wrote and this one should preserve. Physics components are read through it
 * too, and drop what they do not know, for the reason their own fills give.
 *
 * Nested objects recurse; anything else is taken or replaced whole.
 */
export function conform<T>(value: unknown, model: T): T {
  if (typeof model !== 'object' || model === null || Array.isArray(model)) {
    return fits(value, model) ? (value as T) : model;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return model;

  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, expected] of Object.entries(model as Record<string, unknown>)) {
    const given = source[key];
    if (given === undefined) {
      out[key] = expected;
    } else if (typeof expected === 'object' && expected !== null && !Array.isArray(expected)) {
      out[key] = conform(given, expected);
    } else {
      out[key] = fits(given, expected) ? given : expected;
    }
  }
  return out as T;
}

/**
 * The fields of a patch that the model names, each conformed; the rest dropped.
 *
 * A patch is not a whole value — `updateSettings` sends the one setting a dialog
 * changed — so a missing field must stay missing rather than being filled from
 * the model, or every partial update would write the defaults over everything
 * else.
 */
export function conformPatch<T extends object>(value: unknown, model: T): Partial<T> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};

  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, expected] of Object.entries(model as Record<string, unknown>)) {
    if (!(key in source)) continue;
    const given = source[key];
    if (typeof expected === 'object' && expected !== null && !Array.isArray(expected)) {
      out[key] = conform(given, expected);
    } else if (fits(given, expected)) {
      out[key] = given;
    }
    // A field of the wrong kind is left out of the patch rather than replaced
    // by the default: the caller asked to change one thing, and the honest
    // answer to nonsense is to change nothing.
  }
  return out as Partial<T>;
}

/**
 * Whether a value is a member of the union a label record names.
 *
 * An *own* key, because `in` walks the prototype: `'constructor' in labels` is
 * true of every record, and a material read back with `side: 'constructor'`
 * reached three as a side.
 */
export function isMemberOf<T extends string>(value: unknown, labels: Record<T, unknown>): value is T {
  return typeof value === 'string' && Object.hasOwn(labels, value);
}

/**
 * A member of a closed union, or the model's.
 *
 * `conform` cannot do this on its own: a union member is a string like any
 * other, and `typeof` cannot tell `'front'` from `'sideways'`. The lists are
 * the label records from the day the dropdowns stopped re-enumerating their
 * unions — total by construction, so a member added to a union is offered here
 * the same day it exists.
 */
export function oneOf<T extends string>(value: unknown, members: Record<T, unknown>, model: T): T {
  return isMemberOf(value, members) ? value : model;
}
