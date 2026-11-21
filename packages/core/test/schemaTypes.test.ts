import { describe, expect, it } from 'vitest';
import type { Schema } from '../src/fieldSchema';
import { schemaTypeText } from '../src/schemaTypes';

/*
 * A schema's type as text, for a script author's editor: what a script reading
 * a component of the type is handed, field for field, read-only.
 */

const EVERY_KIND = {
  speed: { type: 'number', label: 'Speed', default: 1 },
  on: { type: 'boolean', label: 'On', default: true },
  title: { type: 'string', label: 'Title', default: '' },
  tint: { type: 'color', label: 'Tint', default: '#ffffff' },
  size: { type: 'vec2', label: 'Size', default: [1, 1] },
  offset: { type: 'vec3', label: 'Offset', default: [0, 0, 0] },
  mode: {
    type: 'enum',
    label: 'Mode',
    default: 'walk',
    options: [
      { value: 'walk', label: 'Walk' },
      { value: 'fly', label: 'Fly' },
    ],
  },
  sound: { type: 'asset', label: 'Sound', kind: 'audio' },
  target: { type: 'entity', label: 'Target' },
  shadow: { type: 'object', label: 'Shadow', fields: { bias: { type: 'number', label: 'Bias', default: 0 } } },
  shape: {
    type: 'union',
    label: 'Shape',
    default: 'ball',
    variants: {
      ball: { label: 'Ball', fields: { radius: { type: 'number', label: 'Radius', default: 0.5 } } },
      box: { label: 'Box', fields: { size: { type: 'vec3', label: 'Size', default: [1, 1, 1] } } },
    },
  },
  data: { type: 'custom', label: 'Data', default: {}, decode: (value) => ({ ok: true, value }) },
} as const satisfies Schema;

describe('a schema as text', () => {
  it('prints each field read-only: vectors as tuples, an enum as its values, an asset or entity as text or null, data of its own as unknown', () => {
    expect(schemaTypeText(EVERY_KIND)).toBe(
      [
        '{',
        '  readonly speed: number;',
        '  readonly on: boolean;',
        '  readonly title: string;',
        '  readonly tint: string;',
        '  readonly size: readonly [number, number];',
        '  readonly offset: readonly [number, number, number];',
        '  readonly mode: "walk" | "fly";',
        '  readonly sound: string | null;',
        '  readonly target: string | null;',
        '  readonly shadow: {',
        '    readonly bias: number;',
        '  };',
        '  readonly shape: {',
        '    readonly kind: "ball";',
        '    readonly radius: number;',
        '  } | {',
        '    readonly kind: "box";',
        '    readonly size: readonly [number, number, number];',
        '  };',
        '  readonly data: unknown;',
        '}',
      ].join('\n'),
    );
  });

  it('puts the members it is handed first, and indents from where it is written', () => {
    expect(
      schemaTypeText({ on: { type: 'boolean', label: 'On', default: true } }, '  ', ['readonly id: string', 'readonly type: "lamp"']),
    ).toBe(['{', '    readonly id: string;', '    readonly type: "lamp";', '    readonly on: boolean;', '  }'].join('\n'));
  });

  it('quotes a key that is no identifier', () => {
    expect(schemaTypeText({ 'acme.glow': { type: 'number', label: 'Glow', default: 1 } })).toBe(
      ['{', '  readonly "acme.glow": number;', '}'].join('\n'),
    );
  });
});
