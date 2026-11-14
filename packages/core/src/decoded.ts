/*
 * What reading a value from outside answers: the value, typed, or why it was
 * refused.
 *
 * A file, a message or a script's data arrives as `unknown`. A cast would claim
 * its shape and check nothing, and the wrong value would then fail far from
 * where it entered — a slider bound to `undefined`, a `NaN` in a camera. A
 * decoder checks it once, where it enters, and says where each fault sits, so
 * that a refused file names its own lines instead of throwing somewhere in the
 * engine.
 */

/** Where a value sits in what was read: the keys and the indices from its root. */
export type DecodePath = readonly (string | number)[];

/** One fault in what was read. */
export interface Diagnostic {
  /** What kind of fault, for code that sorts them: `field.missing`, `field.invalid`, `field.unexpected`. */
  readonly code: string;
  /** What was expected and what was found, written to be read after the path. */
  readonly message: string;
  readonly path: DecodePath;
}

/** A value read from outside: the value, or every fault found in it. */
export type Decoded<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

/**
 * A value as a message quotes it. `JSON.stringify` alone writes `NaN` as
 * `null` and `undefined` as nothing, the two values a refusal most needs to
 * show.
 */
export function shown(value: unknown): string {
  return typeof value === 'number' || value === undefined ? String(value) : JSON.stringify(value);
}

/** How many faults a refusal spells out. A file broken ten thousand times says so in a line, not in ten thousand. */
const SPELLED_OUT = 20;

/** Faults as the lines of a refusal: `path: message`, the first few, then how many more. */
export function describeDiagnostics(diagnostics: readonly Diagnostic[]): string {
  const lines = diagnostics.slice(0, SPELLED_OUT).map((fault) => `${fault.path.join('.')}: ${fault.message}`);
  if (diagnostics.length > SPELLED_OUT) lines.push(`and ${diagnostics.length - SPELLED_OUT} more`);
  return lines.join('\n');
}
