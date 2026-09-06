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
import { specFor, type KeyedField } from '../src/inspector/declaredFields';
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
    expect(bind('speed').params).toEqual({ min: 0, max: 20, step: 0.5 });
    expect(bind('speed', { type: 'number' }).params).toEqual({});
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
    expect(bind('mode').params?.options).toEqual({ walk: 'walk', run: 'run' });
    const labelled = bind('mode', {
      type: 'enum',
      options: [{ value: 'walk', label: 'Walking' }],
    });
    expect(labelled.params?.options).toEqual({ Walking: 'walk' });
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

    expect(bind('target').optionsProvider?.()).toEqual({ None: '', Crate: crate.entity.id });
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
      settings: { kind: 'audio', loadMode: 'decode', gain: 1, forceMono: false },
    });
    useAssetStore.setState({
      manifest: {
        ...emptyManifest(),
        assets: [asset('a1', 'Step', 'audio'), asset('t1', 'Brick', 'texture')],
      },
    });

    expect(bind('clip').optionsProvider?.()).toEqual({ None: '', Step: 'a1' });
    expect(bind('clip', { type: 'asset' }).optionsProvider?.()).toEqual({
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
    expect(spec.params?.options).toEqual({ 'sRGB (colour)': 'srgb', 'Linear (data)': 'linear' });
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
