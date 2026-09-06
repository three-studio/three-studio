import {
  MATERIAL_SIDE_LABELS,
  TEXTURE_WRAP_LABELS,
  createMaterial,
  type MaterialDef,
} from './scene/material';
import {
  emptyLayoutPreferences,
  emptyShortcutPreferences,
  type LayoutPreferences,
  type ShortcutPreferences,
} from './preferences/schema';
import { createBuildProfiles, type BuildProfiles, type ProjectSettings } from './project/schema';
import { defaultSettings } from './assets/import';
import type { AssetKind, AssetSettings } from './assets/schema';

/*
 * What the renderer sends, made safe before it reaches the disk.
 *
 * TypeScript is gone at run time, so `patch: Partial<ProjectSettings>` on an
 * IPC handler promises nothing: whatever is in the renderer — a project file's
 * own script, an imported module, a mistake — can send any object at all, and
 * until now it was spread straight into `project.json`. The same held for asset
 * sidecars, material files and layout preferences.
 *
 * The rule is the repo's own, from `docs/ARCHITECTURE.md`: **defend at the
 * boundary, not at every read site.** One check where the value arrives, so
 * that everything downstream can go on assuming the shape it is declared with.
 *
 * By hand and in `core`, because `core` may not take a dependency — the
 * architecture test says so — and because a schema library would be a second
 * declaration of types this package already declares. The model *is* the
 * schema: every one of these values has a factory, and a factory is a complete,
 * correct example of its own type that cannot fall out of step with it.
 */

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
 * wrote and this one should preserve.
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


/*
 * The four values that cross from the renderer and land in a file. Each is a
 * one-liner over the two above and a factory that already existed; what each
 * one is *for* is the sentence beside it.
 */

/**
 * A settings patch, reduced to the fields it is allowed to change.
 *
 * The model is the project's **current** settings rather than a fresh default,
 * because two of the four fields are open: `build.profiles` is keyed by profile
 * id, and a patch that adds one is the ordinary way a build profile is created.
 * Conforming against the live value would drop exactly that.
 */
export function conformSettingsPatch(
  patch: unknown,
  current: ProjectSettings,
): Partial<ProjectSettings> {
  const conformed = conformPatch(patch, current);
  if (conformed.build !== undefined) {
    conformed.build = conformBuildProfiles(
      (patch as { build?: unknown }).build,
      current.build,
    );
  }
  return conformed;
}

/**
 * Build profiles, whose `profiles` is a dictionary and not a shape.
 *
 * `conform` keeps the fields a model names, which is right for everything else
 * here and wrong for this one: the keys are profile ids the author invents. So
 * the dictionary is walked and each profile conformed against one that exists —
 * the active one, or a fresh set if the project somehow has none.
 */
function conformBuildProfiles(value: unknown, current: BuildProfiles): BuildProfiles {
  const model = Object.values(current.profiles)[0] ?? Object.values(createBuildProfiles('Project').profiles)[0]!;
  const given = (typeof value === 'object' && value !== null ? value : {}) as Partial<BuildProfiles>;
  const profiles: BuildProfiles['profiles'] = {};

  // A table is an object, and it has to be said: `Object.entries` walks a
  // string one character at a time, so `profiles: 'oops'` minted four profiles
  // — one per character, each a copy of the model, under the ids `0`…`3`.
  const table = given.profiles;
  const entries = typeof table === 'object' && table !== null && !Array.isArray(table) ? table : {};

  for (const [id, profile] of Object.entries(entries)) {
    profiles[id] = conform(profile, model);
  }
  return {
    active: typeof given.active === 'string' ? given.active : current.active,
    // Never empty: an export with no profile to run is a dialog with nothing in
    // it, and the renderer sending `{}` should not be able to produce one.
    profiles: Object.keys(profiles).length > 0 ? profiles : current.profiles,
  };
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
function oneOf<T extends string>(value: unknown, members: Record<T, unknown>, model: T): T {
  return typeof value === 'string' && value in members ? (value as T) : model;
}

/** A material, written to a `.material.json` and read by every mesh linked to it. */
export function conformMaterial(value: unknown): MaterialDef {
  const model = createMaterial();
  const kept = conform(value, model);
  const given = (typeof value === 'object' && value !== null ? value : {}) as Partial<MaterialDef>;
  return {
    ...kept,
    side: oneOf(given.side, MATERIAL_SIDE_LABELS, model.side),
    wrap: oneOf(given.wrap, TEXTURE_WRAP_LABELS, model.wrap),
  };
}

/**
 * An asset's import settings, written to its sidecar.
 *
 * The model comes from the importer that claims the file, which is the same
 * factory a fresh import fills from — so a field added to a format's settings
 * is defended here the day it exists, without this being told.
 */
export function conformAssetSettings(
  value: unknown,
  kind: AssetKind,
  fileName: string,
): AssetSettings {
  const model = defaultSettings(kind, fileName);
  // The discriminant is the caller's, never the payload's, and `conform` alone
  // would let it through: `'model'` is a string exactly as `'texture'` is. A
  // `.png` whose sidecar said `model` would be built as a mesh on the next
  // load, from the model importer's defaults.
  //
  // The other unions in these settings — a texture's colour space and wrap, a
  // model's up axis — are **not** checked against their members, because they
  // have no list to check against: they are written as `field.enum` options on
  // their importer rather than as a record. A wrong one lands in the sidecar
  // and reads as its default at load; it is a gap, not a hole, and closing it
  // means giving those unions the same treatment `MaterialSide` has.
  return { ...conform(value, model), kind: model.kind } as AssetSettings;
}

/**
 * The remapped shortcuts, written beside the layouts.
 *
 * Every entry is checked one at a time rather than the object being trusted:
 * this file is meant to be edited by hand — there is no interface for it yet —
 * so a stray value is the expected case, not the surprising one. A binding whose
 * value is neither a string nor `null` is dropped; a binding naming a command
 * this build does not have is dropped later, by the editor, which is the only
 * side that knows the list.
 */
export function conformShortcutPreferences(value: unknown): ShortcutPreferences {
  const base = conform(value, emptyShortcutPreferences());
  const given = (typeof value === 'object' && value !== null ? value : {}) as {
    bindings?: unknown;
  };
  const bindings: Record<string, string | null> = {};
  if (typeof given.bindings === 'object' && given.bindings !== null) {
    for (const [binding, command] of Object.entries(given.bindings)) {
      if (command === null || typeof command === 'string') bindings[binding] = command;
    }
  }
  return { ...base, bindings };
}

/** The window layouts, written to the preferences file outside any project. */
export function conformLayoutPreferences(value: unknown): LayoutPreferences {
  const base = conform(value, emptyLayoutPreferences());
  const given = (typeof value === 'object' && value !== null ? value : {}) as Partial<LayoutPreferences>;
  return {
    ...base,
    // `working` is a dockview blob this code has no shape for: it is handed
    // back to the library that made it and is never read field by field here.
    // Kept as an object or dropped, which is the whole of what can be said.
    working: typeof given.working === 'object' ? (given.working ?? null) : null,
    // A list of templates, each with a name and one of those blobs.
    templates: Array.isArray(given.templates)
      ? given.templates.filter(
          (entry): entry is LayoutPreferences['templates'][number] =>
            typeof entry === 'object' &&
            entry !== null &&
            typeof (entry as { name?: unknown }).name === 'string',
        )
      : [],
  };
}
