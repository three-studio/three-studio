import {
  createEmptyScene,
  createMeshEntity,
  emptyManifest,
  field,
  importerForFile,
  type AssetEntry,
  type FieldDef,
  type TextureSettings,
} from '@three-studio/core';
import type { ScriptProperties } from '@three-studio/runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import { declaredControl, specFor, type KeyedField } from '../src/inspector/declaredFields';
import { GEOMETRY_FIELDS, MATERIAL_FIELDS, type FieldSpec } from '../src/inspector/fields';
import { useAssetStore } from '../src/state/assetStore';
import { useDocumentStore } from '../src/state/documentStore';

/*
 * The one adapter, exercised by both producers.
 *
 * A script's declared properties and an importer's declared settings used to be
 * two vocabularies with an adapter each, and only one of the two was ever
 * checked. What matters here is that every variant a script may declare still
 * binds to the control it bound to before, since that is what "the eight
 * variants edit as they did" means once the switch that produced them is gone.
 */

/** A script declaring every variant, as `Behaviour.properties` would. */
const EVERY_VARIANT: ScriptProperties = {
  speed: { type: 'number', default: 5, min: 0, max: 20, step: 0.5 },
  enabled: { type: 'boolean', default: true },
  title: { type: 'string', default: 'Crate' },
  tint: { type: 'color', default: '#ff0000' },
  offset: { type: 'vec3', default: [1, 2, 3] },
  mode: { type: 'enum', options: ['walk', 'run'], default: 'run' },
  target: { type: 'entity', label: 'Follow' },
  clip: { type: 'asset', kind: 'audio' },
};

const bind = (key: string, def: FieldDef = EVERY_VARIANT[key]!) =>
  specFor({ ...def, key } as KeyedField, ['props', key]);

/** What the declared type alone says, which is what the binder asks it. */
const control = (key: string, def: FieldDef = EVERY_VARIANT[key]!) => declaredControl(def);

const row = (fields: readonly FieldSpec[], label: string): FieldSpec => {
  const found = fields.find((field) => field.label === label);
  if (!found) throw new Error(`no field labelled ${label}`);
  return found;
};

beforeEach(() => {
  useDocumentStore.setState({ scene: createEmptyScene() });
  useAssetStore.setState({ manifest: emptyManifest() });
});

describe('a script property, whichever variant it is', () => {
  it('is labelled by its declaration, and by its key when it has none', () => {
    expect(bind('target').label).toBe('Follow');
    expect(bind('speed').label).toBe('speed');
  });

  it('writes into props under the declared key', () => {
    expect(bind('speed').path).toEqual(['props', 'speed']);
  });

  it('narrows a number with only the bounds that were declared', () => {
    expect(control('speed').params).toEqual({ min: 0, max: 20, step: 0.5 });
    expect(control('speed', { type: 'number' }).params).toEqual({});
  });

  it('coerces a number saved as something else, and falls back to the default', () => {
    const { toModel } = bind('speed');
    expect(toModel?.('7')).toBe(7);
    expect(toModel?.(undefined)).toBe(5);
    // Not a number and not convertible: the declared default beats NaN, which
    // Tweakpane would render as an empty text box.
    expect(toModel?.('nope')).toBe(5);
  });

  it('shows the declared default until the designer has set a value', () => {
    expect(bind('enabled').toModel?.(undefined)).toBe(true);
    expect(bind('title').toModel?.(undefined)).toBe('Crate');
    expect(bind('tint').toModel?.(undefined)).toBe('#ff0000');
    expect(bind('mode').toModel?.(undefined)).toBe('run');
    // No default declared: the type's zero, so the row still draws.
    expect(bind('enabled', { type: 'boolean' }).toModel?.(undefined)).toBe(false);
    expect(bind('mode', { type: 'enum', options: ['walk', 'run'] }).toModel?.(undefined)).toBe(
      'walk',
    );
  });

  it('offers an enum as label -> value, from either spelling', () => {
    expect(control('mode').params?.['options']).toEqual({ walk: 'walk', run: 'run' });
    const labelled = control('mode', {
      type: 'enum',
      options: [{ value: 'walk', label: 'Walking' }],
    });
    expect(labelled.params?.['options']).toEqual({ Walking: 'walk' });
  });

  it('converts a vec3 both ways, because the document stores a tuple', () => {
    const spec = bind('offset');
    expect(spec.toModel?.(undefined)).toEqual({ x: 1, y: 2, z: 3 });
    expect(spec.toModel?.([4, 5, 6])).toEqual({ x: 4, y: 5, z: 6 });
    expect(spec.fromModel?.({ x: 4, y: 5, z: 6 })).toEqual([4, 5, 6]);
  });

  it('lists the entities in the scene, plus the empty choice', () => {
    const crate = createMeshEntity('box');
    crate.entity.name = 'Crate';
    const scene = createEmptyScene();
    scene.entities[crate.entity.id] = crate.entity;
    useDocumentStore.setState({ scene });

    expect(control('target').optionsProvider?.()).toEqual({ None: '', Crate: crate.entity.id });
    expect(bind('target').toModel?.(undefined)).toBe('');
  });

  it('lists only the assets of the kind the script asked for', () => {
    const asset = (id: string, name: string, kind: AssetEntry['kind']): AssetEntry => ({
      id,
      name,
      kind,
      path: `assets/${name}`,
      folder: '',
      sizeBytes: 0,
      modifiedAt: 0,
      importedAt: 0,
      hash: '',
      importedPath: null,
      settings: { kind: 'audio', loadMode: 'decode', gain: 1, forceMono: false },
    });
    useAssetStore.setState({
      manifest: {
        ...emptyManifest(),
        assets: [asset('a1', 'Step', 'audio'), asset('t1', 'Brick', 'texture')],
      },
    });

    expect(control('clip').optionsProvider?.()).toEqual({ None: '', Step: 'a1' });
    expect(control('clip', { type: 'asset' }).optionsProvider?.()).toEqual({
      None: '',
      Step: 'a1',
      Brick: 't1',
    });
  });
});

describe('an importer declares in the same words', () => {
  it('binds a real importer row through the same adapter', () => {
    const texture = importerForFile('brick.png')!;
    const settings = texture.defaultSettings('brick.png') as TextureSettings;
    const group = texture.fields(settings)[0]!;
    if (group.type !== 'group') throw new Error('expected a group');

    const colorSpace = group.fields.find((row) => 'key' in row && row.key === 'colorSpace')!;
    if (!('key' in colorSpace)) throw new Error('expected a keyed row');

    const spec = specFor(colorSpace as KeyedField, [colorSpace.key]);
    // A key on a flat settings object, not a path into the document.
    expect(spec.path).toEqual(['colorSpace']);
    expect(declaredControl(colorSpace as KeyedField).params?.['options']).toEqual({
      'sRGB (colour)': 'srgb',
      'Linear (data)': 'linear',
    });
  });

  it('spells a checkbox `toggle` and stores the tag a script writes', () => {
    // The builder is named for what it draws; the tag has to stay `boolean`
    // because that is what a user script — which this repo does not own —
    // already declares.
    expect(field.toggle('flipY', 'Flip Y')).toEqual({
      type: 'boolean',
      key: 'flipY',
      label: 'Flip Y',
    });
  });
});

describe('a component pane declares in the same words', () => {
  it('narrows a number without naming Tweakpane', () => {
    expect(declaredControl(row(GEOMETRY_FIELDS.box, 'Segments X')).params).toEqual({
      min: 1,
      max: 256,
      step: 1,
    });
  });

  it('spreads one set of bounds over every axis of a pad', () => {
    const tiling = row(MATERIAL_FIELDS, 'Tiling');
    const { params, toModel, fromModel } = declaredControl(tiling);
    expect(params).toEqual({ x: { step: 0.1 }, y: { step: 0.1 } });
    expect(toModel?.([2, 3])).toEqual({ x: 2, y: 3 });
    expect(fromModel?.({ x: 2, y: 3 })).toEqual([2, 3]);
  });

  it('leaves a row that has nothing to add alone, for Tweakpane to read the value', () => {
    // A colour, a checkbox and a text field all come from the bound value. A
    // declared type would be a restatement of what the document already says.
    expect(declaredControl(row(MATERIAL_FIELDS, 'Colour'))).toEqual({});
    expect(declaredControl(row(MATERIAL_FIELDS, 'Transparent'))).toEqual({});
  });

  it('does not fill a missing component value the way it fills a script one', () => {
    // The belt in `PaneBinder`: a field the document has no value for is
    // skipped and said out loud, rather than shown as a zero that would be
    // written back on the first drag.
    expect(declaredControl(row(MATERIAL_FIELDS, 'Roughness')).toModel).toBeUndefined();
    expect(bind('speed').toModel?.(undefined)).toBe(5);
  });
});
