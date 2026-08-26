import { createAudioSource } from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { COMPONENT_SCHEMAS, isAction, isSeparator, type FieldSpec } from '../src/inspector/schema';

/*
 * The pane declarations, checked where they carry logic of their own.
 *
 * Most rows are a path and a label and are not worth a test. The ones here are
 * not: `toModel` / `fromModel` convert between what the document stores and what
 * the control shows, and a converter that is wrong shows a field that reads
 * correctly and writes nonsense.
 */

function fields(type: 'audioSource'): FieldSpec[] {
  return COMPONENT_SCHEMAS[type].fields.filter(
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
