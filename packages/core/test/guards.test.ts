import {
  conform,
  conformAssetSettings,
  conformLayoutPreferences,
  conformMaterial,
  conformSettingsPatch,
  createBuildProfiles,
  createMaterial,
  createPhysicsSettings,
  createRenderingSettings,
  type ProjectSettings,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';

/*
 * What the renderer sends, before it reaches the disk.
 *
 * TypeScript is gone at run time, so an IPC handler declaring
 * `patch: Partial<ProjectSettings>` promises nothing at all: whatever runs in
 * the renderer — a project's own script, an imported module, a mistake — can
 * send any object, and it used to be spread straight into `project.json`.
 *
 * Every payload below is written by hand and deliberately wrong, because that
 * is the only way to test a guard: a well-formed one proves nothing.
 */

const settings = (): ProjectSettings => ({
  loadingScene: null,
  rendering: createRenderingSettings(),
  physics: createPhysicsSettings(),
  build: createBuildProfiles('Test'),
});

describe('a settings patch', () => {
  it('keeps the fields it is allowed to change', () => {
    const patch = conformSettingsPatch({ loadingScene: 'scene-1' }, settings());
    expect(patch).toEqual({ loadingScene: 'scene-1' });
  });

  it('drops a field of the wrong kind rather than writing it', () => {
    // The caller asked to change one thing; the honest answer to nonsense is
    // to change nothing.
    expect(conformSettingsPatch({ loadingScene: 42 }, settings())).toEqual({});
  });

  it('drops a field nothing declares', () => {
    expect(conformSettingsPatch({ evil: 'rm -rf', __proto__: {} }, settings())).toEqual({});
  });

  it('leaves the fields it was not given alone', () => {
    // A patch is not a whole value: filling the missing fields from a model
    // would write the defaults over every other setting.
    const patch = conformSettingsPatch({ rendering: createRenderingSettings() }, settings());
    expect(Object.keys(patch)).toEqual(['rendering']);
  });

  it('repairs one bad field of a section and keeps the rest', () => {
    const patch = conformSettingsPatch(
      { rendering: { ...createRenderingSettings(), maxPixelRatio: 'huge', antialias: false } },
      settings(),
    );
    expect(patch.rendering?.maxPixelRatio).toBe(createRenderingSettings().maxPixelRatio);
    expect(patch.rendering?.antialias).toBe(false);
  });

  it('refuses a number that cannot be written and read back', () => {
    // `NaN` costs nothing to write and everything to find: `JSON.stringify`
    // turns it into `null`, and every comparison against it answers false.
    const patch = conformSettingsPatch(
      { rendering: { ...createRenderingSettings(), exposure: Number.NaN } },
      settings(),
    );
    expect(patch.rendering?.exposure).toBe(createRenderingSettings().exposure);
  });

  it('keeps a build profile the project does not have yet', () => {
    // The keys are ids the author invents, so adding one is how a profile is
    // created. A guard that conformed the dictionary against the model would
    // drop exactly that.
    const current = settings();
    const existing = Object.values(current.build.profiles)[0]!;
    const patch = conformSettingsPatch(
      { build: { active: 'new', profiles: { new: { ...existing, name: 'Second' } } } },
      current,
    );
    expect(patch.build?.profiles['new']?.name).toBe('Second');
    expect(patch.build?.active).toBe('new');
  });

  it('refuses a profile table that is not a table', () => {
    // `Object.entries` walks a string one character at a time, so a `profiles`
    // that is not an object minted one profile per character, each a copy of
    // the model under the id `0`, `1`, `2`… A table is an object or it is
    // nothing.
    const current = settings();
    const patch = conformSettingsPatch({ build: { active: 'web', profiles: 'oops' } }, current);
    expect(patch.build?.profiles).toEqual(current.build.profiles);
  });

  it('never leaves a project with no build profile at all', () => {
    const current = settings();
    const patch = conformSettingsPatch({ build: { active: 'x', profiles: {} } }, current);
    expect(Object.keys(patch.build?.profiles ?? {})).toEqual(Object.keys(current.build.profiles));
  });
});

describe('a material', () => {
  it('does not corrupt the file when a field has the wrong type', () => {
    const material = conformMaterial({ ...createMaterial(), roughness: 'shiny', wireframe: 'yes' });
    expect(material.roughness).toBe(createMaterial().roughness);
    expect(material.wireframe).toBe(createMaterial().wireframe);
  });

  it('keeps a texture slot, and its empty value', () => {
    // A slot is `string | null`, which is the one shape a model cannot state:
    // the factory has `null` there, so `null` and a string are both accepted.
    expect(conformMaterial({ ...createMaterial(), colorMap: 'asset-1' }).colorMap).toBe('asset-1');
    expect(conformMaterial({ ...createMaterial(), colorMap: null }).colorMap).toBeNull();
    expect(conformMaterial({ ...createMaterial(), colorMap: 7 }).colorMap).toBeNull();
  });

  it('refuses a union member that is not one', () => {
    // A string is a string to `typeof`; the label records are what tell
    // `'front'` from `'sideways'`.
    expect(conformMaterial({ ...createMaterial(), side: 'sideways' }).side).toBe('front');
    expect(conformMaterial({ ...createMaterial(), side: 'double' }).side).toBe('double');
    expect(conformMaterial({ ...createMaterial(), wrap: 'wobble' }).wrap).toBe('repeat');
  });

  it('rejects a tuple of the wrong length', () => {
    // `tiling` is a `Vec2`. A three-element array is a different type, not a
    // longer one, and three lands in a shader as a silent mistake.
    expect(conformMaterial({ ...createMaterial(), tiling: [1, 2, 3] }).tiling).toEqual([1, 1]);
    expect(conformMaterial({ ...createMaterial(), tiling: [2, 3] }).tiling).toEqual([2, 3]);
  });

  it('builds a whole material out of nothing', () => {
    expect(conformMaterial(null)).toEqual(createMaterial());
    expect(conformMaterial('not an object')).toEqual(createMaterial());
  });
});

describe("an asset's import settings", () => {
  it('is filled from the importer that claims the file', () => {
    const kept = conformAssetSettings({ kind: 'texture', anisotropy: 'lots' }, 'texture', 'a.png');
    expect(kept.kind).toBe('texture');
    expect((kept as { anisotropy: number }).anisotropy).toBe(1);
  });

  it('cannot be made to look like another kind', () => {
    // The kind is the sidecar's, and the payload does not get a vote: a `.png`
    // whose settings said `model` would be built as a mesh on the next load.
    const kept = conformAssetSettings({ kind: 'model', scale: 1000 }, 'texture', 'a.png');
    expect(kept.kind).toBe('texture');
  });
});

describe('the window layouts', () => {
  it('drops a template that is not one', () => {
    const kept = conformLayoutPreferences({
      version: 1,
      working: null,
      templates: [{ name: 'Wide', layout: {} }, 'not a template', { layout: {} }],
    });
    expect(kept.templates).toHaveLength(1);
    expect(kept.templates[0]?.name).toBe('Wide');
  });

  it('survives a payload that is nothing like one', () => {
    expect(conformLayoutPreferences(42).templates).toEqual([]);
    expect(conformLayoutPreferences(42).working).toBeNull();
  });
});

describe('conform, on its own', () => {
  it('recurses into a nested shape', () => {
    const model = { a: 1, deep: { b: 'x', c: true } };
    expect(conform({ a: 2, deep: { b: 9, c: false } }, model)).toEqual({
      a: 2,
      deep: { b: 'x', c: false },
    });
  });

  it('replaces a nested value that is not an object', () => {
    expect(conform({ deep: 'flat' }, { deep: { b: 'x' } })).toEqual({ deep: { b: 'x' } });
  });
});
