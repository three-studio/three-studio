import { describe, expect, it } from 'vitest';
import {
  MAX_COLLISION_LAYERS,
  PROJECT_FORMAT_VERSION,
  createBuildProfiles,
  createDefaultLayer,
  createPhysicsSettings,
  createRenderingSettings,
  createSceneId,
  decodeProjectFile,
  isRecord,
  versionRefusal,
  type Decoded,
  type ProjectFile,
} from '../src/index';

/*
 * `project.json`, decoded where it is read: every field the interfaces name,
 * of the kind they name, and nothing else. A project of another format is
 * refused whole, in one line, before anything else in it is read; a field that
 * is missing, mistyped or unknown is refused where it sits. Nothing is filled
 * in and nothing is converted: until 1.0.0 a format that moves is a project the
 * branch refuses, with words saying so.
 */

const start = createSceneId();

/** A project as `createProject` writes it: every section from its factory. */
function created(): ProjectFile {
  return {
    version: PROJECT_FORMAT_VERSION,
    name: 'Decoded',
    engineVersion: '0.6.0',
    startScene: start,
    settings: {
      loadingScene: null,
      rendering: createRenderingSettings(),
      physics: createPhysicsSettings(),
      build: createBuildProfiles('Decoded'),
    },
  };
}

/** `created()` with the record at `path`'s parent changed by `change`, handed the last key. */
function edited(path: readonly string[], change: (record: Record<string, unknown>, key: string) => void): unknown {
  const copy: unknown = structuredClone(created());
  let record = copy;
  for (const key of path.slice(0, -1)) record = isRecord(record) ? record[key] : undefined;
  const last = path.at(-1);
  if (!isRecord(record) || last === undefined) throw new Error(`no record holds ${path.join('.')}`);
  change(record, last);
  return copy;
}

/** The code and the path of each fault. */
function faults(decoded: Decoded<unknown>): (string | number)[][] {
  return decoded.ok ? [] : decoded.diagnostics.map(({ code, path }) => [code, ...path]);
}

describe('a project file', () => {
  it('decodes, as `createProject` writes it, equal to what was written', () => {
    expect(decodeProjectFile(created())).toEqual({ ok: true, value: created() });
    expect(decodeProjectFile(JSON.parse(JSON.stringify(created())))).toEqual({ ok: true, value: created() });
  });

  it('decodes a loading scene, a profile of its own and a table of layers', () => {
    const project = created();
    const loading = createSceneId();
    project.settings.loadingScene = loading;
    project.settings.physics.layers = [
      { ...createDefaultLayer(), ignores: ['ghost'] },
      { id: 'ghost', name: 'Ghost', ignores: ['ghost'] },
    ];
    project.settings.build = {
      active: 'itch',
      profiles: {
        ...createBuildProfiles('Decoded').profiles,
        itch: {
          name: 'Itch',
          target: 'web',
          scenes: [start, loading],
          outputDir: '/tmp/out',
          includeAllAssets: true,
          title: 'My Game',
          basePath: '/games/demo/',
        },
      },
    };

    expect(decodeProjectFile(structuredClone(project))).toEqual({ ok: true, value: project });
  });

  it.each([
    [['name']],
    [['engineVersion']],
    [['startScene']],
    [['settings']],
    [['settings', 'loadingScene']],
    [['settings', 'rendering']],
    [['settings', 'rendering', 'batching']],
    [['settings', 'physics', 'gravity']],
    [['settings', 'physics', 'layers']],
    [['settings', 'build', 'active']],
    [['settings', 'build', 'profiles']],
    [['settings', 'build', 'profiles', 'web', 'basePath']],
  ])('refuses a project missing %j, there and nowhere else', (path) => {
    const decoded = decodeProjectFile(edited(path, (record, key) => delete record[key]));

    expect(faults(decoded)).toEqual([['field.missing', ...path]]);
  });

  it.each([
    [['name'], 3],
    [['engineVersion'], null],
    [['startScene'], ''],
    [['startScene'], 7],
    [['settings'], []],
    [['settings', 'loadingScene'], ''],
    [['settings', 'rendering', 'antialias'], 'yes'],
    [['settings', 'rendering', 'maxPixelRatio'], 'two'],
    [['settings', 'physics', 'gravity'], [0, -9.81]],
    [['settings', 'physics', 'layers'], 'default'],
    [['settings', 'build', 'active'], 1],
    [['settings', 'build', 'profiles', 'web', 'target'], 'ios'],
    [['settings', 'build', 'profiles', 'web', 'scenes'], ['']],
    [['settings', 'build', 'profiles', 'web', 'outputDir'], 3],
    [['settings', 'build', 'profiles', 'web'], 'Web'],
  ])('refuses %j holding %j, where it sits', (path, value) => {
    const decoded = decodeProjectFile(edited(path, (record, key) => (record[key] = value)));

    expect(faults(decoded)).toEqual([['field.invalid', ...path]]);
  });

  it.each([
    // The list of scenes this file held until format 2: the directory is the list now.
    [['scenes'], [{ id: 'a', name: 'main', path: 'scenes/main.scene.json' }]],
    [['settings', 'rendering', 'dither'], true],
    [['settings', 'build', 'profiles', 'web', 'platform'], 'web'],
  ])('refuses %j, which is no field this build reads', (path, value) => {
    const decoded = decodeProjectFile(edited(path, (record, key) => (record[key] = value)));

    expect(faults(decoded)).toEqual([['field.unexpected', ...path]]);
  });

  it('collects every fault at once', () => {
    const decoded = decodeProjectFile({ ...created(), name: 3, settings: { ...created().settings, rendering: null }, extra: 1 });

    expect(faults(decoded)).toEqual([
      ['field.invalid', 'name'],
      ['field.invalid', 'settings', 'rendering'],
      ['field.unexpected', 'extra'],
    ]);
  });

  it.each([[[]], ['project'], [null]])('refuses %j, which is no project at all', (value) => {
    expect(faults(decodeProjectFile(value))).toEqual([['field.invalid']]);
  });
});

describe('a project of another format', () => {
  it.each([[PROJECT_FORMAT_VERSION - 1], [PROJECT_FORMAT_VERSION + 1], ['3'], [undefined]])(
    'is refused at version %j, in one diagnostic and nothing else',
    (version) => {
      const decoded = decodeProjectFile({ ...created(), version, name: 3, settings: 'none' });

      expect(decoded).toEqual(versionRefusal(version, PROJECT_FORMAT_VERSION));
    },
  );

  it('is any but 4, this build\'s own', () => {
    expect(PROJECT_FORMAT_VERSION).toBe(4);
    expect(decodeProjectFile({ ...created(), version: 3 })).toEqual(versionRefusal(3, 4));
  });
});

describe('a table of collision layers', () => {
  const layers = (table: unknown) =>
    decodeProjectFile(edited(['settings', 'physics', 'layers'], (record, key) => (record[key] = table)));

  it('decodes as the editor writes it', () => {
    const table = [createDefaultLayer(), { id: 'ghost', name: 'Ghost', ignores: ['default'] }];

    expect(layers(table)).toMatchObject({ ok: true, value: { settings: { physics: { layers: table } } } });
  });

  it.each([
    ['without Default first', [{ id: 'ghost', name: 'Ghost', ignores: [] }, createDefaultLayer()]],
    [
      `of ${MAX_COLLISION_LAYERS + 1}`,
      [createDefaultLayer(), ...Array.from({ length: MAX_COLLISION_LAYERS }, (_, index) => ({ id: `l${index}`, name: `L${index}`, ignores: [] }))],
    ],
    ['with a repeated id', [createDefaultLayer(), { id: 'ghost', name: 'Ghost', ignores: [] }, { id: 'ghost', name: 'Ghost 2', ignores: [] }]],
    ['with an empty id', [createDefaultLayer(), { id: '', name: 'Nobody', ignores: [] }]],
    ['ignoring a layer it lacks', [{ ...createDefaultLayer(), ignores: ['ghost'] }]],
    ['empty', []],
  ])('is refused %s, as one fault of the table', (_what, table) => {
    expect(layers(table)).toEqual({
      ok: false,
      diagnostics: [{ code: 'layers.invalid', message: expect.any(String), path: ['settings', 'physics', 'layers'] }],
    });
  });

  it('refuses a malformed layer where it sits', () => {
    expect(faults(layers([createDefaultLayer(), { id: 'ghost', name: 7, ignores: [], solid: true }]))).toEqual([
      ['field.invalid', 'settings', 'physics', 'layers', 1, 'name'],
      ['field.unexpected', 'settings', 'physics', 'layers', 1, 'solid'],
    ]);
    expect(faults(layers([createDefaultLayer(), 'ghost']))).toEqual([['field.invalid', 'settings', 'physics', 'layers', 1]]);
  });
});
