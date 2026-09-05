import {
  COMPONENT_TYPES,
  SUN_CUSTOM,
  SUN_FROM_SKY,
  createComponent,
  createEnvironment,
  type ComponentDoc,
  type LightComponent,
  type LightKind,
  type WaterComponent,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { SCENE_SCHEMA, paneEntriesFor, sceneSignature } from '../src/inspector/schema';
import { shapeOf } from '../src/inspector/signature';

/*
 * What decides whether the Inspector is rebuilt or merely refreshed.
 *
 * The shape used to be a nine-armed switch restating by hand every `visibleWhen`
 * in `schema.ts`, ending in `default: return component.type`. A type not named
 * in it could never rebuild its panel at all: the values would refresh and the
 * conditional rows would never arrive. No type falls in that hole today — the
 * three the switch did not name declare no conditional row — which is exactly
 * why nobody would have found it before shipping one that did.
 */

/** The shape a component's pane would take, as the panel computes it. */
function shape(component: ComponentDoc): string {
  const { key, entries } = paneEntriesFor(component);
  return `${key}/${shapeOf(entries, component)}`;
}

function light(kind: LightKind, castShadow = false): LightComponent {
  return { ...createComponent('light'), kind, castShadow };
}

function water(sunSource: WaterComponent['sunSource']): WaterComponent {
  return { ...createComponent('water'), sunSource };
}

describe('every component type is measured, not defaulted', () => {
  it('gives each type one bit per declared entry', () => {
    // The `default:` arm returned the bare type name, so a type it did not know
    // had a shape that could never change. Every type now answers with as many
    // bits as it has rows, which is the shape being read rather than guessed.
    for (const type of COMPONENT_TYPES) {
      const { entries } = paneEntriesFor(createComponent(type));
      expect(shapeOf(entries, createComponent(type))).toHaveLength(entries.length);
    }
  });

  it('names the two lists that are not fixed by the type, and only those', () => {
    // A mesh's geometry slot and a script's declared properties change the list
    // itself, which no arrangement of bits can express. Everything else does.
    const keys = COMPONENT_TYPES.map((type) => paneEntriesFor(createComponent(type)).key);
    expect(keys.filter((key) => key.includes(':')).sort()).toEqual(['mesh:box', 'script:']);
  });
});

describe('a light', () => {
  it('gives every kind its own shape', () => {
    const kinds: readonly LightKind[] = [
      'ambient',
      'hemisphere',
      'directional',
      'point',
      'spot',
      'rectArea',
      'projector',
    ];
    const shapes = kinds.map((kind) => shape(light(kind)));
    expect(new Set(shapes).size).toBe(kinds.length);
  });

  it('changes shape when it starts casting a shadow', () => {
    // Six shadow rows appear with the tick. The hand-written signature had this
    // one right, and it is here because it is the thing most likely to be lost.
    expect(shape(light('directional', true))).not.toBe(shape(light('directional', false)));
  });

  it('hides the tick itself on a kind three has no shadow path for', () => {
    /*
     * `castShadow` is conditional on the kind, which is the thing the
     * hand-written signature could not know: it interpolated
     * `component.castShadow` whatever the light was. Asked of the schema, the
     * answer depends on the kind — and that is the whole difference between
     * restating a declaration and reading it.
     */
    const tick = paneEntriesFor(light('rectArea')).entries.find(
      (entry) => 'path' in entry && entry.path[0] === 'castShadow',
    );
    expect(tick?.visibleWhen?.(light('rectArea'))).toBe(false);
    expect(tick?.visibleWhen?.(light('directional'))).toBe(true);
  });
});

describe('a model', () => {
  it('keeps its shape when a material is linked, which the switch did not', () => {
    /*
     * The one behaviour this commit changes, and it changes it for the better.
     *
     * The switch carried `model:${materialId ?? 'file'}`, borrowed from the mesh
     * arm where linking really does swap two buttons. A model has neither: its
     * material slot is unconditional and there is no "Save as Asset…" beside it,
     * because a model has no embedded `MaterialDef` to extract. So linking one
     * moved no row and still threw the pane away and rebuilt it. Now it
     * refreshes, which is what keeps focus and drag state.
     */
    const linked: ComponentDoc = { ...createComponent('model'), materialId: 'mat-1' };
    expect(shape(linked)).toBe(shape(createComponent('model')));
  });
});

describe('water', () => {
  it('changes shape when the sun becomes a custom one', () => {
    // Choosing a sun decides whether the two manual fields exist at all.
    expect(shape(water(SUN_CUSTOM))).not.toBe(shape(water(SUN_FROM_SKY)));
  });
});

describe('the scene pane', () => {
  it('gives the three background modes three signatures', () => {
    const modes = ['color', 'texture', 'sky'] as const;
    const signatures = modes.map((backgroundMode) =>
      sceneSignature({ ...createEnvironment(), backgroundMode }),
    );
    expect(new Set(signatures).size).toBe(modes.length);
  });

  it('gives a folder a bit of its own', () => {
    /*
     * `SCENE_SCHEMA`'s Sky section carries a `visibleWhen`, and `buildScene` has
     * always honoured it. The hand-written signature listed four environment
     * fields and never that predicate — which today is covered by luck, since
     * the predicate reads `backgroundMode` and so did the list. The next
     * section-level condition would not have been, and this is what makes that
     * a non-question: a section is measured like anything else, so the string is
     * one bit per entry with the sections among them.
     */
    const sections = SCENE_SCHEMA.length;
    const fields = SCENE_SCHEMA.reduce((total, section) => total + section.fields.length, 0);
    expect(sceneSignature(createEnvironment())).toHaveLength(sections + fields);
  });
});
