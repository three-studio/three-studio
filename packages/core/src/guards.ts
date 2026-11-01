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
import {
  conformPhysicsSettings,
  createBuildProfiles,
  type BuildProfiles,
  type ProjectSettings,
} from './project/schema';
import { defaultSettings } from './assets/import';
import type { AssetKind, AssetSettings } from './assets/schema';
import { conform, conformPatch, isRecord, oneOf } from './conform';

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

/*
 * The four values that cross from the renderer and land in a file. Each is a
 * one-liner over `conform` and `conformPatch` and a factory that already
 * existed; what each one is *for* is the sentence beside it.
 */

/**
 * A settings patch, reduced to the fields it is allowed to change.
 *
 * The model is the project's **current** settings rather than a fresh default,
 * because two of the four fields are open: `build.profiles` is keyed by profile
 * id, and a patch that adds one is the ordinary way a build profile is created.
 * Conforming against the live value would drop exactly that. The physics
 * section's layer table is a list of any length, read by its own conformer for
 * the same reason: a patch adding a layer came back with the current table.
 */
export function conformSettingsPatch(
  patch: unknown,
  current: ProjectSettings,
): Partial<ProjectSettings> {
  const conformed = conformPatch(patch, current);
  const given = isRecord(patch) ? patch : {};
  if (conformed.build !== undefined) {
    conformed.build = conformBuildProfiles(given['build'], current.build);
  }
  if (conformed.physics !== undefined) {
    conformed.physics = conformPhysicsSettings(given['physics'], current.physics);
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
