import {
  assertDefined,
  colliderType,
  createColliderShape,
  createEntity,
  createLight,
  type ComponentDoc,
  type LightKind,
  type Schema,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { sceneWith } from '../../core/test/fixtures';
import { derivedPane } from '../src/inspector/derivePane';
import { extendPane, isSeparator, type FieldSpec, type PaneRow } from '../src/inspector/fields';
import { useDocumentStore } from '../src/state/documentStore';

/*
 * A pane derived from a schema, whatever its fields hold: a row per leaf, an
 * object's rows under its condition, a union's selector and the rows of the
 * variant a component holds, nothing for data shaped elsewhere. What
 * derivation cannot say, a type's editor part adds: rows drawn in place of a
 * field's own, entries after a field's last row, a key of its own.
 *
 * The schemas are written here, and read the fields real components hold — a
 * light, a collider — so that a condition or a variant is asked of the data the
 * Inspector would hand it.
 */

/** A row's data, without its functions: what JSON keeps. */
function written(entries: readonly PaneRow[]): unknown {
  return JSON.parse(JSON.stringify(entries));
}

/** The labels of the rows a component shows, a rule as `—`. */
function shown(entries: readonly PaneRow[], component: ComponentDoc): string[] {
  return entries.flatMap((entry) => {
    if (isSeparator(entry)) return ['—'];
    if (entry.visibleWhen && !entry.visibleWhen(component)) return [];
    return ['path' in entry ? entry.label : entry.title];
  });
}

/** The field row labelled `label`. */
function row(entries: readonly PaneRow[], label: string): FieldSpec {
  const found = entries.find((entry): entry is FieldSpec => 'path' in entry && entry.label === label);
  return assertDefined(found, `the row "${label}"`);
}

const light = (kind: LightKind, castShadow = true): ComponentDoc => ({ ...createLight(kind), castShadow });

describe('a leaf', () => {
  const leaves = {
    count: { type: 'number', label: 'Count', default: 1, min: 0, max: 10, step: 1 },
    angle: { type: 'number', label: 'Angle', default: 0, min: 0, max: 90, step: 1, unit: 'radians' },
    on: { type: 'boolean', label: 'On', default: true },
    title: { type: 'string', label: 'Title', default: '' },
    tint: { type: 'color', label: 'Tint', default: '#ffffff' },
    tiling: { type: 'vec2', label: 'Tiling', default: [1, 1], min: 0, step: 0.1 },
    aim: { type: 'vec3', label: 'Aim', default: [0, 1, 0] },
    turn: { type: 'vec3', label: 'Turn', default: [0, 0, 0], step: 1, unit: 'radians' },
    side: { type: 'enum', label: 'Side', default: 'front', options: [{ value: 'front', label: 'Front' }, { value: 'back', label: 'Back' }] },
    material: { type: 'asset', label: 'Material', kind: 'material', emptyLabel: 'Embedded' },
    body: { type: 'entity', label: 'Body', emptyLabel: 'World' },
    props: { type: 'custom', label: 'Properties', default: {}, decode: (value) => ({ ok: true, value }) },
  } as const satisfies Schema;
  const { entries } = derivedPane('light', leaves, undefined, light('point'));

  it('is a row each, with only what its kind declares, and none for data shaped elsewhere', () => {
    expect(written(entries)).toEqual([
      { path: ['count'], label: 'Count', type: 'number', min: 0, max: 10, step: 1 },
      { path: ['angle'], label: 'Angle', type: 'number', min: 0, max: 90, step: 1 },
      { path: ['on'], label: 'On' },
      { path: ['title'], label: 'Title' },
      { path: ['tint'], label: 'Tint' },
      { path: ['tiling'], label: 'Tiling', type: 'vec2', min: 0, step: 0.1 },
      { path: ['aim'], label: 'Aim', type: 'vec3' },
      { path: ['turn'], label: 'Turn', type: 'vec3', step: 1 },
      { path: ['side'], label: 'Side', type: 'enum', options: [{ value: 'front', label: 'Front' }, { value: 'back', label: 'Back' }] },
      { params: { view: 'asset', assetKind: 'material', emptyLabel: 'Embedded' }, path: ['material'], label: 'Material' },
      { path: ['body'], label: 'Body', type: 'entity' },
    ]);
  });

  it('shows an angle in degrees, and stores what is typed in radians', () => {
    const angle = row(entries, 'Angle');
    const turn = row(entries, 'Turn');

    expect(angle.toModel?.(Math.PI / 2)).toBeCloseTo(90);
    expect(angle.fromModel?.(45)).toBeCloseTo(Math.PI / 4);
    expect(turn.toModel?.([Math.PI, 0, Math.PI / 2])).toEqual({ x: 180, y: 0, z: 90 });
    expect(turn.fromModel?.({ x: 90, y: 0, z: 0 })).toEqual([Math.PI / 2, 0, 0]);
  });

  it('offers the scene\'s entities by name, the empty choice under the name its field gives it', () => {
    const door = createEntity('Door');
    useDocumentStore.getState().replaceScene(sceneWith([door]));
    const body = row(entries, 'Body');

    expect(body.optionsProvider?.()).toEqual({ World: '', Door: door.entity.id });
    expect(body.toModel?.(null)).toBe('');
    expect(body.fromModel?.('')).toBeNull();
    expect(body.fromModel?.(door.entity.id)).toBe(door.entity.id);
  });
});

describe('an object', () => {
  /** A light's own fields, and its shadow's, as a schema could say them. */
  const lit = {
    kind: { type: 'enum', label: 'Kind', default: 'spot', shown: false, options: [{ value: 'directional', label: 'Directional' }, { value: 'spot', label: 'Spot' }, { value: 'projector', label: 'Projector' }] },
    castShadow: { type: 'boolean', label: 'Cast shadow', default: true },
    shadow: {
      type: 'object',
      label: 'Shadow',
      separatorBefore: true,
      shownWhen: { field: 'castShadow', equals: true },
      fields: {
        bias: { type: 'number', label: 'Bias', default: 0 },
        // `kind` is no field of the shadow: it is the light's, around it.
        orthoSize: { type: 'number', label: 'Ortho size', default: 20, shownWhen: { field: 'kind', equals: 'directional' } },
        focus: { type: 'number', label: 'Focus', default: 1, shownWhen: { field: 'kind', oneOf: ['spot', 'projector'] } },
      },
    },
  } as const satisfies Schema;
  const { entries } = derivedPane('light', lit, undefined, light('spot'));

  it('gives its fields\' rows at their paths, a rule before the first', () => {
    expect(written(entries)).toEqual([
      { path: ['castShadow'], label: 'Cast shadow' },
      { kind: 'separator' },
      { path: ['shadow', 'bias'], label: 'Bias', type: 'number' },
      { path: ['shadow', 'orthoSize'], label: 'Ortho size', type: 'number' },
      { path: ['shadow', 'focus'], label: 'Focus', type: 'number' },
    ]);
  });

  it('shows each row under the object\'s condition and its own, read wherever the field sits', () => {
    expect(shown(entries, light('directional'))).toEqual(['Cast shadow', '—', 'Bias', 'Ortho size']);
    expect(shown(entries, light('spot'))).toEqual(['Cast shadow', '—', 'Bias', 'Focus']);
    expect(shown(entries, light('spot', false))).toEqual(['Cast shadow', '—']);
  });

  it('draws none of its rows when it is not shown itself', () => {
    const hidden = { ...lit, shadow: { ...lit.shadow, shown: false } } satisfies Schema;

    expect(shown(derivedPane('light', hidden, undefined, light('spot')).entries, light('spot'))).toEqual(['Cast shadow']);
  });
});

describe('a union', () => {
  /** A collider's shape, with fewer measures than the collider's own. */
  const shaped = {
    shape: {
      type: 'union',
      label: 'Shape',
      default: 'box',
      variants: {
        box: { label: 'Box', fields: { size: { type: 'vec3', label: 'Size', default: [1, 1, 1] } } },
        sphere: {
          label: 'Sphere',
          fields: {
            radius: { type: 'number', label: 'Radius', default: 0.5 },
            center: { type: 'vec3', label: 'Center', default: [0, 0, 0] },
          },
        },
      },
    },
    isSensor: { type: 'boolean', label: 'Is sensor', default: false },
  } as const satisfies Schema;
  const box = colliderType.create();
  const sphere: ComponentDoc = { ...colliderType.create(), shape: createColliderShape('sphere') };

  it('is a selector of its variants, then the rows of the one the component holds', () => {
    expect(written(derivedPane('collider', shaped, undefined, box).entries)).toEqual([
      { path: ['shape'], label: 'Shape', type: 'enum', options: [{ value: 'box', label: 'Box' }, { value: 'sphere', label: 'Sphere' }] },
      { path: ['shape', 'size'], label: 'Size', type: 'vec3' },
      { path: ['isSensor'], label: 'Is sensor' },
    ]);
    expect(shown(derivedPane('collider', shaped, undefined, sphere).entries, sphere)).toEqual([
      'Shape',
      'Radius',
      'Center',
      'Is sensor',
    ]);
  });

  it('reads the kind, and writes the chosen variant whole at its defaults, as one value', () => {
    const selector = row(derivedPane('collider', shaped, undefined, box).entries, 'Shape');

    expect(selector.toModel?.(createColliderShape('box'))).toBe('box');
    expect(selector.fromModel?.('sphere')).toEqual({ kind: 'sphere', radius: 0.5, center: [0, 0, 0] });
  });

  it('keys the pane by its type and the variant held, so another variant is another list', () => {
    expect(derivedPane('collider', shaped, undefined, box).key).toBe('collider:box');
    expect(derivedPane('collider', shaped, undefined, sphere).key).toBe('collider:sphere');
    expect(derivedPane('light', { on: { type: 'boolean', label: 'On', default: true } }, undefined, light('spot')).key).toBe('light');
  });

  it('draws no selector when it is not shown, and still the rows of its variant', () => {
    const hidden = { ...shaped, shape: { ...shaped.shape, shown: false } } satisfies Schema;

    expect(shown(derivedPane('collider', hidden, undefined, sphere).entries, sphere)).toEqual(['Radius', 'Center', 'Is sensor']);
  });

  it('is derived once per variant: asked again, the same rows', () => {
    expect(derivedPane('collider', shaped, undefined, box)).toBe(derivedPane('collider', shaped, undefined, colliderType.create()));
    expect(derivedPane('collider', shaped, undefined, box)).not.toBe(derivedPane('collider', shaped, undefined, sphere));
  });
});

describe('a type\'s extension', () => {
  const shaped = {
    shape: {
      type: 'union',
      label: 'Shape',
      default: 'box',
      variants: {
        box: { label: 'Box', fields: { size: { type: 'vec3', label: 'Size', default: [1, 1, 1] } } },
        sphere: { label: 'Sphere', fields: { radius: { type: 'number', label: 'Radius', default: 0.5 } } },
      },
    },
    layer: { type: 'string', label: 'Layer', default: 'default' },
    material: {
      type: 'object',
      label: 'Material',
      fields: { friction: { type: 'number', label: 'Friction', default: 0.5 } },
    },
    isSensor: { type: 'boolean', label: 'Is sensor', default: false },
  } as const satisfies Schema;
  const fit = { kind: 'action', title: 'Fit to Mesh', run: () => undefined } as const;
  const save = { kind: 'action', title: 'Save as Asset…', run: () => undefined } as const;
  const sphere: ComponentDoc = { ...colliderType.create(), shape: createColliderShape('sphere') };

  it('draws rows in place of a field\'s own, and puts entries after a field\'s last row', () => {
    const extension = extendPane('collider', {
      drawers: { layer: (layer) => (layer === null ? [] : [{ ...layer, optionsProvider: () => ({ Default: 'default' }) }]) },
      after: { shape: [fit], material: [save] },
    });
    const { entries } = derivedPane('collider', shaped, extension, sphere);

    expect(shown(entries, sphere)).toEqual(['Shape', 'Radius', 'Fit to Mesh', 'Layer', 'Friction', 'Save as Asset…', 'Is sensor']);
    expect(row(entries, 'Layer').optionsProvider?.()).toEqual({ Default: 'default' });
  });

  it('draws in place of a union\'s selector alone: the rows of its variant follow', () => {
    const extension = extendPane('collider', {
      drawers: { shape: () => [{ path: ['shape'], label: 'Form' }] },
    });

    expect(shown(derivedPane('collider', shaped, extension, sphere).entries, sphere)).toEqual([
      'Form',
      'Radius',
      'Layer',
      'Friction',
      'Is sensor',
    ]);
  });

  it('adds its own key, and says whether its rows tune the running game', () => {
    const extension = extendPane('collider', {
      paneKey: (collider) => (collider.isSensor ? 'sensor' : 'solid'),
      live: true,
    });
    const pane = derivedPane('collider', shaped, extension, sphere);

    expect(pane.key).toBe('collider:sphere:solid');
    expect(derivedPane('collider', shaped, extension, { ...sphere, isSensor: true }).key).toBe('collider:sphere:sensor');
    expect(pane.live).toBe(true);
    expect(derivedPane('collider', shaped, undefined, sphere).live).toBe(false);
  });

  it('is asked of its own type alone', () => {
    const extension = extendPane('collider', { paneKey: () => 'mine' });

    expect(extension.paneKey?.(light('spot'))).toBe('');
    expect(extension.paneKey?.(sphere)).toBe('mine');
  });
});
