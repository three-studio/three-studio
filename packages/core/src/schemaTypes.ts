import type { Schema, SchemaField } from './fieldSchema';

/*
 * A schema's value as TypeScript text, for the typings a script author's
 * editor reads: what `Infer` gives the kernel's own code, said in the words
 * an author's program can hold without the kernel's types — an id is text, a
 * colour is text, a vector a tuple — and read-only all through, since what a
 * script reads of the document is frozen.
 *
 * Derived from the schema, as the decoder and the pane are, so a module's type
 * reaches an author's editor with nothing written for it by hand.
 */

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * The object type of `schema`'s values: `{`, a member per line indented one
 * step past `indent`, then `}` at `indent`. `leading` are members written
 * before the fields, without their `;` — a component's `id` and `type`.
 */
export function schemaTypeText(schema: Schema, indent = '', leading: readonly string[] = []): string {
  const inner = `${indent}  `;
  const members = [
    ...leading,
    ...Object.entries(schema).map(([key, field]) => `readonly ${keyText(key)}: ${fieldTypeText(field, inner)}`),
  ];
  return ['{', ...members.map((member) => `${inner}${member};`), `${indent}}`].join('\n');
}

function keyText(key: string): string {
  return IDENTIFIER.test(key) ? key : JSON.stringify(key);
}

function fieldTypeText(field: SchemaField, indent: string): string {
  switch (field.type) {
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'string':
    case 'color':
      return 'string';
    case 'vec2':
      return 'readonly [number, number]';
    case 'vec3':
      return 'readonly [number, number, number]';
    case 'enum':
      return field.options.map((option) => JSON.stringify(option.value)).join(' | ');
    case 'asset':
    case 'entity':
      return 'string | null';
    case 'object':
      return schemaTypeText(field.fields, indent);
    case 'union':
      return Object.entries(field.variants)
        .map(([kind, variant]) => schemaTypeText(variant.fields, indent, [`readonly kind: ${JSON.stringify(kind)}`]))
        .join(' | ');
    case 'custom':
      return 'unknown';
  }
}
