import {
  COMPONENT_TYPES,
  createAudioSource,
  createComponent,
  createEmptyScene,
  type ComponentType,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { COMPONENT_PANES, paneEntriesFor } from '../src/components/panes';
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
  const rowsOf = (type: ComponentType): FieldSpec[] =>
    paneEntriesFor(createComponent(type)).entries.filter(
      (entry): entry is FieldSpec => 'path' in entry,
    );

  const axesOf = (spec: FieldSpec): number | null =>
    spec.type === 'vec2' ? 2 : spec.type === 'vec3' ? 3 : null;

  it.each(COMPONENT_TYPES)('%s', (type) => {
    const component = createComponent(type);
    for (const spec of rowsOf(type)) {
      const value = readPath(component, spec.path);
      const axes = axesOf(spec);

      if (Array.isArray(value) && value.every((item) => typeof item === 'number')) {
        // A row with converters of its own has said what it is doing; one
        // without is handing three numbers to a control that wants an object.
        if (spec.toModel === undefined) {
          expect({ row: `${type}.${spec.path.join('.')}`, axes }).toEqual({
            row: `${type}.${spec.path.join('.')}`,
            axes: value.length,
          });
        }
      } else if (axes !== null) {
        expect({ row: `${type}.${spec.path.join('.')}`, value }).toEqual({
          row: `${type}.${spec.path.join('.')}`,
          value: expect.any(Array),
        });
      }
    }
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
