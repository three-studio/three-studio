import type { StagedFile } from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import {
  applySettingsToKin,
  buildImportPlan,
  createRows,
  resetRow,
  summarise,
  updateRowSettings,
  type ImportRow,
} from '../src/import/plan';

/*
 * What the dialog sends to the main process, and what it does not. Pure on
 * purpose: this is the part of the import that decides, and it is testable
 * without a window because nothing in it is a widget.
 */

const model = (id: string, fileName = `${id}.fbx`): StagedFile => ({
  id,
  fileName,
  sourcePath: `/tmp/${fileName}`,
  sizeBytes: 10,
  importerId: 'model.fbx',
  kind: 'model',
  formatLabel: 'FBX',
  settings: {
    kind: 'model',
    format: 'fbx',
    scale: 1,
    upAxis: 'y',
    generateColliders: false,
    importMaterials: true,
    importAnimations: true,
    collisionMeshes: 'ignore',
  },
  conflict: null,
  companions: [],
});

const texture = (id: string, encoding: 'sdr' | 'ultrahdr' = 'sdr'): StagedFile => ({
  id,
  fileName: `${id}.png`,
  sourcePath: `/tmp/${id}.png`,
  sizeBytes: 10,
  importerId: 'texture',
  kind: 'texture',
  formatLabel: 'Texture',
  settings: {
    kind: 'texture',
    colorSpace: 'srgb',
    wrap: 'repeat',
    flipY: true,
    encoding,
    generateMipmaps: true,
    anisotropy: 1,
  },
  conflict: null,
  companions: [],
});

const unsupported = (id: string): StagedFile => ({
  id,
  fileName: `${id}.txt`,
  sourcePath: `/tmp/${id}.txt`,
  sizeBytes: 10,
  importerId: null,
  kind: null,
  formatLabel: '',
  settings: null,
  conflict: null,
  companions: [],
});

const ids = (rows: readonly ImportRow[]): string[] => rows.map((row) => row.file.id);

const clip = (id: string, seconds: number): StagedFile => ({
  id,
  fileName: `${id}.wav`,
  sourcePath: `/tmp/${id}.wav`,
  sizeBytes: 10,
  importerId: 'audio',
  kind: 'audio',
  formatLabel: 'Audio',
  settings: { kind: 'audio', loadMode: 'decode', gain: 1, forceMono: false, seconds },
  conflict: null,
  companions: [],
});

describe('what starts ticked', () => {
  it('takes everything an importer claims', () => {
    const rows = createRows([model('a'), texture('b')]);
    expect(rows.every((row) => row.included)).toBe(true);
  });

  it('leaves a file nothing imports out, and unticked', () => {
    const rows = createRows([unsupported('notes')]);
    expect(rows[0]?.included).toBe(false);
    expect(buildImportPlan(rows, '')).toEqual([]);
  });

  it('leaves bytes the project already has out, without hiding them', () => {
    // A second copy is allowed — it is the author's project — but it mints a
    // second id for one asset, so it should be a decision rather than a default.
    const duplicate = {
      ...model('a'),
      conflict: { kind: 'duplicate' as const, existingPath: 'assets/models/a.fbx', existingId: 'x' },
    };
    const rows = createRows([duplicate]);
    expect(rows[0]?.included).toBe(false);
    expect(ids(rows)).toEqual(['a']);
  });

  it('ticks a name collision, which renaming already handles', () => {
    const clash = {
      ...model('a'),
      conflict: { kind: 'name' as const, existingPath: 'assets/models/a.fbx' },
    };
    expect(createRows([clash])[0]?.included).toBe(true);
  });
});

describe('the plan', () => {
  it('carries only what was ticked, at the folder that was chosen', () => {
    const rows = createRows([model('a'), model('b'), unsupported('c')]);
    const without = rows.map((row) => (row.file.id === 'b' ? { ...row, included: false } : row));

    const plan = buildImportPlan(without, 'props/trees');
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ fileId: 'a', folder: 'props/trees', fileName: 'a.fbx' });
  });

  it('sends the settings as edited, not as staged', () => {
    const rows = createRows([model('a')]);
    const edited = updateRowSettings(rows, 'a', { ...rows[0]!.settings!, scale: 0.01 });
    expect(buildImportPlan(edited, '')[0]?.settings).toMatchObject({ scale: 0.01 });
  });
});

describe('apply to all', () => {
  it('reaches every file of the same format and no others', () => {
    const rows = updateRowSettings(
      createRows([model('a'), model('b'), texture('c')]),
      'a',
      { ...model('a').settings!, scale: 0.01 } as never,
    );

    const applied = applySettingsToKin(rows, 'a');
    expect(applied[1]?.settings).toMatchObject({ scale: 0.01 });
    // A texture has none of a model's fields; copying across would be nonsense.
    expect(applied[2]?.settings).toMatchObject({ kind: 'texture' });
    expect(applied[2]?.settings).not.toHaveProperty('scale');
  });

  it("leaves alone what only a file's own bytes could say", () => {
    // The encoding was sniffed per file. Copying an Ultra HDR image's onto an
    // ordinary JPEG would tell a photograph it carries a gainmap, and the
    // loader would then refuse it.
    const rows = createRows([texture('sky', 'ultrahdr'), texture('brick', 'sdr')]);
    const applied = applySettingsToKin(
      updateRowSettings(rows, 'sky', { ...rows[0]!.settings!, colorSpace: 'linear' }),
      'sky',
    );

    expect(applied[1]?.settings).toMatchObject({ colorSpace: 'linear', encoding: 'sdr' });
    expect(applied[0]?.settings).toMatchObject({ encoding: 'ultrahdr' });
  });

  it("leaves a clip's own length, channels and rate behind", () => {
    // Read when the preview decoded *that* file. Copied onto forty others they
    // would put a confident, wrong duration on every tile in the Project panel,
    // and nothing downstream could tell it was invented.
    const rows = createRows([clip('intro', 93.4), clip('stinger', 1.2)]);
    const applied = applySettingsToKin(
      updateRowSettings(rows, 'intro', { ...rows[0]!.settings!, gain: 0.5 }),
      'intro',
    );

    expect(applied[1]?.settings).toMatchObject({ gain: 0.5, seconds: 1.2 });
    expect(applied[0]?.settings).toMatchObject({ seconds: 93.4 });
  });

  it('does nothing when the row has nothing to give', () => {
    const rows = createRows([unsupported('notes'), model('a')]);
    expect(applySettingsToKin(rows, 'notes')).toEqual(rows);
  });
});

describe('reset', () => {
  it('goes back to what the session staged, not to a fresh factory', () => {
    // The staged settings are the only ones that ever saw the file: a texture's
    // encoding was read out of its bytes, and a factory cannot know it.
    const staged = texture('sky', 'ultrahdr');
    const rows = updateRowSettings(createRows([staged]), 'sky', {
      ...staged.settings!,
      colorSpace: 'linear',
    });

    expect(resetRow(rows, 'sky')[0]?.settings).toMatchObject({
      colorSpace: 'srgb',
      encoding: 'ultrahdr',
    });
  });
});

describe('the counts under the list', () => {
  it('separates what can be imported from what was chosen', () => {
    const rows = createRows([
      model('a'),
      { ...model('b'), conflict: { kind: 'duplicate', existingPath: 'p', existingId: 'x' } },
      unsupported('c'),
    ]);

    expect(summarise(rows)).toEqual({
      included: 1,
      importable: 2,
      unsupported: 1,
      duplicates: 1,
    });
  });
});
