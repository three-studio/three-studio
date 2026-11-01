import {
  COLLIDER_SHAPE_LABELS,
  COMPONENT_TYPES,
  JOINT_KIND_LABELS,
  PROJECT_FORMAT_VERSION,
  conformColliderShape,
  conformJointMotion,
  createAudioSource,
  createBuildProfiles,
  createColliderShape,
  createComponent,
  createDefaultLayer,
  createEmptyScene,
  createPhysicsSettings,
  createRenderingSettings,
  fieldOptions,
  type ComponentDoc,
  type ComponentType,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { COMPONENT_PANES, paneEntriesFor } from '../src/components/panes';
import { useProjectStore } from '../src/state/projectStore';
import { declaredControl } from '../src/inspector/declaredFields';
import { SCENE_SCHEMA, sceneFieldPath, isAction, isSeparator, type FieldSpec } from '../src/inspector/schema';
import { readPath } from '../src/inspector/target';

/*
 * The pane declarations, checked where they carry logic of their own.
 *
 * Most rows are a path and a label and are not worth a test. The ones here are
 * not: `toModel` / `fromModel` convert between what the document stores and what
 * the control shows, and a converter that is wrong shows a field that reads
 * correctly and writes nonsense.
 */

function fields(type: 'audioSource'): FieldSpec[] {
  return COMPONENT_PANES[type].fields.filter(
    (entry): entry is FieldSpec => !isSeparator(entry) && !isAction(entry) && 'path' in entry,
  );
}

function field(type: 'audioSource', label: string): FieldSpec {
  const found = fields(type).find((spec) => spec.label === label);
  if (!found) throw new Error(`no field labelled ${label}`);
  return found;
}

describe('the Audio Source pane', () => {
  it('offers the blend as a switch and as a dial, both onto the one field', () => {
    const onBlend = fields('audioSource').filter((spec) => spec.path[0] === 'spatialBlend');
    expect(onBlend.map((spec) => spec.label)).toEqual(['Spatialize', '2D  ↔  3D']);
  });

  it('shows Spatialize ticked for anything that is not fully flat', () => {
    const { toModel } = field('audioSource', 'Spatialize');
    expect(toModel?.(0)).toBe(false);
    expect(toModel?.(0.6)).toBe(true);
    expect(toModel?.(1)).toBe(true);
  });

  it('writes the two ends of the dial, and nothing in between', () => {
    const { fromModel } = field('audioSource', 'Spatialize');
    expect(fromModel?.(true)).toBe(1);
    expect(fromModel?.(false)).toBe(0);
  });

  it('starts a new source spatialized, which is what the switch will show', () => {
    // The default is `1`, and the switch has to agree with it or a source added
    // from the Add menu reads as flat in a pane that is about to prove it is not.
    const { toModel } = field('audioSource', 'Spatialize');
    expect(toModel?.(createAudioSource().spatialBlend)).toBe(true);
  });

  it('leaves the dial always reachable, so a blend can be dialled back up', () => {
    // The falloff rows are conditional; this one must not be, or unticking the
    // switch would take away the only control that can undo it by degrees.
    expect(field('audioSource', '2D  ↔  3D').visibleWhen).toBeUndefined();
  });
});

/*
 * A collider's rows change with its shape's kind, so the checks below that walk
 * every type's factory walk a collider of every kind too.
 */
const COLLIDER_KINDS = Object.keys(COLLIDER_SHAPE_LABELS);

function colliderOfKind(kind: string): ComponentDoc {
  const shape = conformColliderShape({ kind });
  // The factory box comes back for a kind it does not know, which would test
  // the box twice and the kind not at all.
  expect(shape.kind).toBe(kind);
  return { ...createComponent('collider'), shape };
}

/** A joint's rows change with its kind, as a collider's do with its shape. */
const JOINT_KINDS = Object.keys(JOINT_KIND_LABELS);

function jointOfKind(kind: string): ComponentDoc {
  const motion = conformJointMotion({ kind });
  expect(motion.kind).toBe(kind);
  return { ...createComponent('joint'), motion };
}

describe('the Joint pane', () => {
  it.each(JOINT_KINDS)('is a pane of its own for a %s', (kind) => {
    expect(paneEntriesFor(jointOfKind(kind)).key).toBe(`joint:${kind}`);
  });

  it('shows the world as the choice for no Connected Body, and writes it back as none', () => {
    const row = COMPONENT_PANES.joint.fields.find(
      (entry): entry is FieldSpec => 'path' in entry && entry.path.join('.') === 'connectedEntity',
    );
    if (!row) throw new Error('no Connected Body row');
    expect(row.toModel?.(null)).toBe('');
    expect(row.fromModel?.('')).toBeNull();
    expect(row.fromModel?.('door')).toBe('door');
    expect(row.optionsProvider?.()).toMatchObject({ World: '' });
  });
});

describe('the Collider pane', () => {
  const shapeRow = (): FieldSpec => {
    const row = COMPONENT_PANES.collider.fields.find(
      (entry): entry is FieldSpec => 'path' in entry && entry.path.join('.') === 'shape',
    );
    if (!row) throw new Error('no Shape row');
    return row;
  };

  it('shows the kind of the shape it reads', () => {
    expect(shapeRow().toModel?.({ kind: 'capsule', radius: 0.3, height: 1.7 })).toBe('capsule');
  });

  it("writes a kind as that kind's whole default shape", () => {
    // A box and a sphere share no measure, so another kind starts from its own.
    expect(shapeRow().fromModel?.('sphere')).toEqual(createColliderShape('sphere'));
  });

  it('shows a rotation in degrees and writes it back in radians', () => {
    const row = paneEntriesFor(colliderOfKind('box')).entries.find(
      (entry): entry is FieldSpec => 'path' in entry && entry.path.join('.') === 'shape.rotation',
    );
    if (!row) throw new Error('no Rotation row');
    const shown = row.toModel?.([Math.PI / 2, 0, -Math.PI]);
    expect(shown).toEqual({ x: expect.closeTo(90, 9), y: 0, z: expect.closeTo(-180, 9) });
    const written = row.fromModel?.({ x: 90, y: 0, z: 45 });
    expect(written).toEqual([expect.closeTo(Math.PI / 2, 9), 0, expect.closeTo(Math.PI / 4, 9)]);
  });

  it.each(COLLIDER_KINDS)('is a pane of its own for a %s', (kind) => {
    expect(paneEntriesFor(colliderOfKind(kind)).key).toBe(`collider:${kind}`);
  });

  it("lists the project's layers by name in its Layer row", () => {
    const row = COMPONENT_PANES.collider.fields.find(
      (entry): entry is FieldSpec => 'path' in entry && entry.path.join('.') === 'layer',
    );
    if (!row) throw new Error('no Layer row');

    useProjectStore.setState({
      project: {
        version: PROJECT_FORMAT_VERSION,
        name: 'Layers',
        engineVersion: '0.6.0',
        startScene: 'scene-1',
        settings: {
          loadingScene: null,
          rendering: createRenderingSettings(),
          physics: {
            ...createPhysicsSettings(),
            layers: [createDefaultLayer(), { id: 'p1', name: 'Player', ignores: [] }],
          },
          build: createBuildProfiles('Layers'),
        },
      },
    });
    expect(row.optionsProvider?.()).toEqual({ Default: 'default', Player: 'p1' });

    useProjectStore.setState({ project: null });
    expect(row.optionsProvider?.()).toEqual({ Default: 'default' });
  });
});

/*
 * A tuple in the document has to be declared as a pad, and a pad has to be
 * reading a tuple.
 *
 * Written after a conversion pair was dropped from `water.sunDirection` during
 * the move to a declared vocabulary. Nothing failed: the row simply bound a
 * three-element array to a control that wants `{ x, y, z }`, which is the kind
 * of mistake that is invisible until someone opens that one panel. Both
 * directions are checked, because either half alone lets it back in.
 */
describe('every row that reads a tuple says so', () => {
  const rowsOf = (component: ComponentDoc): FieldSpec[] =>
    paneEntriesFor(component).entries.filter((entry): entry is FieldSpec => 'path' in entry);

  const axesOf = (spec: FieldSpec): number | null =>
    spec.type === 'vec2' ? 2 : spec.type === 'vec3' ? 3 : null;

  function checkTuples(where: string, component: ComponentDoc): void {
    for (const spec of rowsOf(component)) {
      const value = readPath(component, spec.path);
      const axes = axesOf(spec);

      if (Array.isArray(value) && value.every((item) => typeof item === 'number')) {
        // A row with converters of its own has said what it is doing; one
        // without is handing three numbers to a control that wants an object.
        if (spec.toModel === undefined) {
          expect({ row: `${where}.${spec.path.join('.')}`, axes }).toEqual({
            row: `${where}.${spec.path.join('.')}`,
            axes: value.length,
          });
        }
      } else if (axes !== null) {
        expect({ row: `${where}.${spec.path.join('.')}`, value }).toEqual({
          row: `${where}.${spec.path.join('.')}`,
          value: expect.any(Array),
        });
      }
    }
  }

  it.each(COMPONENT_TYPES)('%s', (type) => {
    checkTuples(type, createComponent(type));
  });

  it.each(COLLIDER_KINDS)('a collider of kind %s', (kind) => {
    checkTuples(`collider:${kind}`, colliderOfKind(kind));
  });

  it.each(JOINT_KINDS)('a joint of kind %s', (kind) => {
    checkTuples(`joint:${kind}`, jointOfKind(kind));
  });

  it('holds for the scene pane too', () => {
    const scene = createEmptyScene();
    for (const section of SCENE_SCHEMA) {
      for (const field of section.fields) {
        const value = readPath(scene, sceneFieldPath(field));
        if (Array.isArray(value) && field.toModel === undefined) {
          expect(`${field.on}.${field.key}`).toBe('never reached');
        }
      }
    }
  });
});

/*
 * Nothing a row declares reaches Tweakpane except the parameters it understands.
 *
 * The point of declaring the control rather than handing over a `BindingParams`
 * is that a pane can be written without naming Tweakpane at all — which only
 * holds while the translation is total. A `type` arriving in the parameters
 * would be an unknown key that Tweakpane silently ignores, and the row would
 * lose its range with nothing said.
 */
describe('a declaration reaches Tweakpane only as parameters it knows', () => {
  const KNOWN = new Set([
    'min',
    'max',
    'step',
    'options',
    'view',
    'assetKind',
    'emptyLabel',
    'x',
    'y',
    'z',
  ]);

  const paramsOf = (spec: FieldSpec<never>): Record<string, unknown> => ({
    ...declaredControl(spec).params,
    ...spec.params,
  });

  it.each(COMPONENT_TYPES)('%s', (type) => {
    for (const spec of paneEntriesFor(createComponent(type)).entries) {
      if (!('path' in spec)) continue;
      const unknown = Object.keys(paramsOf(spec as FieldSpec<never>)).filter(
        (key) => !KNOWN.has(key),
      );
      expect({ row: `${type}.${spec.path.join('.')}`, unknown }).toEqual({
        row: `${type}.${spec.path.join('.')}`,
        unknown: [],
      });
    }
  });

  it('holds for the scene pane too', () => {
    for (const section of SCENE_SCHEMA) {
      for (const field of section.fields) {
        const spec = { ...field, path: sceneFieldPath(field) } as FieldSpec<never>;
        const unknown = Object.keys(paramsOf(spec)).filter((key) => !KNOWN.has(key));
        expect({ row: `${field.on}.${field.key}`, unknown }).toEqual({
          row: `${field.on}.${field.key}`,
          unknown: [],
        });
      }
    }
  });
});

/*
 * What a row says its control is, checked against what the document holds there.
 *
 * `sameShape` used to guard this at runtime, in the two setters of the scene
 * pane, with a comment saying that "the Inspector schema pairing a field with a
 * control that fits it is a promise the compiler cannot check". Most of it can
 * be checked — here, once, against real documents — and what is checked here
 * does not need re-checking on every keystroke of every drag.
 *
 * The `enum` case is the one this was written for: its choices are now derived
 * from the union they show, so a stored value outside them means the derivation
 * and the document have come apart.
 */
describe('a declared control fits the value it is bound to', () => {
  /** Rows that answer for themselves: a converter, or a control of its own. */
  const declaresItsOwn = (spec: FieldSpec) => spec.toModel !== undefined || spec.params !== undefined;

  function check(where: string, spec: FieldSpec, value: unknown): void {
    if (declaresItsOwn(spec)) return;
    const at = `${where}.${spec.path.join('.')}`;

    if (spec.type === 'enum') {
      const values = fieldOptions(spec.options).map((option) => option.value);
      expect({ at, ok: values.includes(value as string) }).toEqual({ at, ok: true });
      return;
    }
    if (spec.type === 'number') {
      expect({ at, type: typeof value }).toEqual({ at, type: 'number' });
      return;
    }
    if (spec.type === undefined) {
      // Nothing declared, so Tweakpane reads the value — and it can only read
      // the three primitives it builds a control from.
      expect({ at, ok: ['boolean', 'string', 'number'].includes(typeof value) }).toEqual({
        at,
        ok: true,
      });
    }
  }

  it.each(COMPONENT_TYPES)('%s', (type) => {
    const component = createComponent(type);
    for (const spec of paneEntriesFor(component).entries) {
      if (!('path' in spec)) continue;
      check(type, spec, readPath(component, spec.path));
    }
  });

  it.each(COLLIDER_KINDS)('a collider of kind %s', (kind) => {
    const component = colliderOfKind(kind);
    for (const spec of paneEntriesFor(component).entries) {
      if (!('path' in spec)) continue;
      check(`collider:${kind}`, spec, readPath(component, spec.path));
    }
  });

  it.each(JOINT_KINDS)('a joint of kind %s', (kind) => {
    const component = jointOfKind(kind);
    for (const spec of paneEntriesFor(component).entries) {
      if (!('path' in spec)) continue;
      check(`joint:${kind}`, spec, readPath(component, spec.path));
    }
  });

  it('holds for the scene pane too', () => {
    const scene = createEmptyScene();
    for (const section of SCENE_SCHEMA) {
      for (const field of section.fields) {
        const spec = { ...field, path: sceneFieldPath(field) } as FieldSpec;
        check(field.on, spec, readPath(scene, spec.path));
      }
    }
  });
});
