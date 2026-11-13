/*
 * The checked form of a non-null assertion.
 *
 * `rows[0]!` tells the compiler a value is there and checks nothing. When it is
 * not, the `undefined` travels on and fails somewhere else, far from the line
 * that assumed it — or fails nowhere, and a test passes on a value that never
 * existed. This checks where the assumption is made, and says what was missing.
 *
 * In `core`, because it is the one package every other package, app, test and
 * tool may import without breaking a layer, and sources need it as much as
 * tests do: most of their `!` follow an index under `noUncheckedIndexedAccess`.
 * A thrown `Error` fails a test with its message, as an `expect` would, so one
 * function serves both.
 */

/**
 * The value, checked at run time: what `value!` assumed. Throws, naming `name`,
 * on `undefined` or `null`.
 *
 * It returns the value rather than narrowing it in place (`asserts value`), so
 * that it replaces a `!` where the `!` stood — after an index, a call or a
 * member — without a variable for each one. `name` is required, and reads as
 * the subject of the message: "the first row", not "row".
 */
export function assertDefined<T>(value: T, name: string): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error(`Expected ${name} to be defined, got ${String(value)}`);
  }
  return value;
}
