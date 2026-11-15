import { isRecord, isUsableNumber } from '../../conform';
import { checks, type DecodePath, type Decoded, type Diagnostic } from '../../decoded';
import type { Infer, Schema } from '../../fieldSchema';
import type { Component, Vec2, Vec3 } from '../../scene/primitives';

/** What a script's declared property can hold, of the kinds a script declares one in. */
export type ScriptPropValue = number | string | boolean | Vec2 | Vec3;

function isPropValue(value: unknown): value is ScriptPropValue {
  return isUsableNumber(value) || typeof value === 'string' || typeof value === 'boolean' || checks.vec2.is(value) || checks.vec3.is(value);
}

/**
 * The values a script's properties were given, each checked as a value a
 * property can hold. Which properties there are is the script's to declare, in
 * code only the game runs, so a property is kept by its name whatever the
 * script says today: one the script no longer declares stays, and is used
 * again the day it does.
 */
function decodeProps(value: unknown, path: DecodePath): Decoded<Record<string, ScriptPropValue>> {
  if (!isRecord(value)) {
    return { ok: false, diagnostics: [{ code: 'field.invalid', message: 'expected properties by name', path }] };
  }
  const props: Record<string, ScriptPropValue> = {};
  const diagnostics: Diagnostic[] = [];
  for (const [key, held] of Object.entries(value)) {
    if (isPropValue(held)) props[key] = held;
    else {
      diagnostics.push({
        code: 'field.invalid',
        message: 'expected a number, a string, true or false, or two or three numbers',
        path: [...path, key],
      });
    }
  }
  return diagnostics.length === 0 ? { ok: true, value: props } : { ok: false, diagnostics };
}

/** A user script on an entity, and the values its declared properties were given, as their fields. */
export const scriptSchema = {
  assetId: { type: 'asset', label: 'Script', kind: 'script' },
  /*
   * Stored sparsely: only what the designer has touched. A string among them
   * may be an asset picked in the Inspector, an entity's id or a line of
   * dialogue, and nothing outside the script can tell — so each string counts
   * where an asset answers to it, and is renamed where it names a copied
   * entity. Without it, the texture a script was handed shipped in no build
   * that did not ship the whole project.
   */
  props: { type: 'custom', label: 'Properties', default: {}, decode: decodeProps, candidates: true },
} as const satisfies Schema;

export type ScriptComponent = Component<'script', Infer<typeof scriptSchema>>;
