import { isRecord, isUsableNumber } from './conform';
import {
  fixedId,
  isAssetId,
  isComponentId,
  isEntityId,
  isSceneId,
  type AssetId,
  type ComponentId,
  type EntityId,
  type SceneId,
} from './ids';
import type { Hex, Vec2, Vec3 } from './scene/primitives';

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
 *
 * Every decoder reads through what this file holds — the schema kernel's, and
 * those written by hand for what no schema describes (a file's shell, the
 * project). One set of checks, so that a colour is "#rrggbb" in a project file
 * and in a component alike, and one set of words for a refusal, so that every
 * refused file reads the same in the Console.
 */

/** Where a value sits in what was read: the keys and the indices from its root. */
export type DecodePath = readonly (string | number)[];

/**
 * The kinds of fault a decoder names, each once, for code that sorts them.
 *
 * - `format.version`: a file of another format, refused before anything else in it is read;
 * - `field.missing`, `field.invalid`, `field.unexpected`: a field absent, of the wrong kind, or none at all;
 * - `variant.unknown`: a union's `kind` that names none of its variants;
 * - `type.version`: a component type written at another version than this build's;
 * - `key.mismatch`: an id that is not the key it is filed under;
 * - `table.unversioned`: a file's component table with no version recorded, or a version with no table;
 * - `layers.invalid`: a collision layer table no editor writes.
 */
export type DiagnosticCode =
  | 'format.version'
  | 'field.missing'
  | 'field.invalid'
  | 'field.unexpected'
  | 'variant.unknown'
  | 'type.version'
  | 'key.mismatch'
  | 'table.unversioned'
  | 'layers.invalid';

/** One fault in what was read. */
export interface Diagnostic {
  readonly code: DiagnosticCode;
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

/** The fault of a value that is not what was expected. */
export function invalid(path: DecodePath, expected: string, found: unknown): Diagnostic {
  return { code: 'field.invalid', message: `expected ${expected}, found ${shown(found)}`, path };
}

/** The fault of a field the value does not hold. */
export function missing(path: DecodePath): Diagnostic {
  return { code: 'field.missing', message: 'is missing', path };
}

/**
 * The fault of a key that is no field. Refused rather than dropped: a key this
 * build does not read is either a typo made by hand or a field a newer build
 * wrote, and saving the file back without it would lose that work in silence.
 */
export function unexpected(path: DecodePath): Diagnostic {
  return { code: 'field.unexpected', message: 'is no field this build reads', path };
}

// ------------------------------------------------------------------ the checks

/**
 * What a single value has to be: a number, a colour, an id. A leaf, since
 * what holds other values — a record, a list of records — is read by the
 * decoder that knows its fields.
 */
export interface Check<T> {
  /** What a value has to be, as a refusal says it: "a finite number". */
  readonly expected: string;
  is(value: unknown): value is T;
  /**
   * What a read that failed answers, so that the decoder reading a record
   * field by field can still write its result as one literal. Never kept: the
   * failed read's fault refuses the whole value.
   */
  readonly standIn: T;
}

const HEX = /^#[0-9a-f]{6}$/i;

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isHex(value: unknown): value is Hex {
  return typeof value === 'string' && HEX.test(value);
}

function isVec2(value: unknown): value is Vec2 {
  return Array.isArray(value) && value.length === 2 && value.every(isUsableNumber);
}

function isVec3(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every(isUsableNumber);
}

/** The checks every decoder shares; see `checks`. */
export interface LeafChecks {
  readonly number: Check<number>;
  readonly boolean: Check<boolean>;
  readonly string: Check<string>;
  readonly color: Check<Hex>;
  readonly vec2: Check<Vec2>;
  readonly vec3: Check<Vec3>;
  readonly entityId: Check<EntityId>;
  readonly componentId: Check<ComponentId>;
  readonly assetId: Check<AssetId>;
  readonly sceneId: Check<SceneId>;
}

/**
 * The leaf checks every decoder shares, by what they check. A schema's field
 * kinds read the first six by their own names.
 *
 * Only usable numbers: `NaN` and the infinities are written by
 * `JSON.stringify` as `null`, so a file holding one could not be read back as
 * it was saved. An id's stand-in names nothing: it is never kept.
 */
export const checks: LeafChecks = {
  number: { expected: 'a finite number', is: isUsableNumber, standIn: 0 },
  boolean: { expected: 'true or false', is: isBoolean, standIn: false },
  string: { expected: 'a string', is: isString, standIn: '' },
  color: { expected: 'a colour written #rrggbb', is: isHex, standIn: '#000000' },
  vec2: { expected: 'two finite numbers', is: isVec2, standIn: [0, 0] },
  vec3: { expected: 'three finite numbers', is: isVec3, standIn: [0, 0, 0] },
  entityId: { expected: 'an entity id', is: isEntityId, standIn: fixedId('entity', '(refused)') },
  componentId: { expected: 'a component id', is: isComponentId, standIn: fixedId('component', '(refused)') },
  assetId: { expected: 'an asset id', is: isAssetId, standIn: fixedId('asset', '(refused)') },
  sceneId: { expected: 'a scene id', is: isSceneId, standIn: fixedId('scene', '(refused)') },
};

/** A check that also takes `null`: an asset slot or an entity field with nothing chosen. */
export function nullable<T>(check: Check<T>): Check<T | null> {
  return {
    expected: `${check.expected} or null`,
    is: (value): value is T | null => value === null || check.is(value),
    standIn: null,
  };
}

/**
 * A check that takes a list whose every item `check` takes: a profile's
 * scenes, an entity's children. A list refused is refused whole, where it sits.
 */
export function listOf<T>(check: Check<T>): Check<T[]> {
  return {
    expected: `a list, each item ${check.expected}`,
    is: (value): value is T[] => Array.isArray(value) && value.every((item) => check.is(item)),
    standIn: [],
  };
}

/** A check that takes these values and no other: the options of a choice. */
export function oneOf<const T extends string | number | boolean | null>(values: readonly T[]): Check<T> {
  const [first] = values;
  if (first === undefined) throw new Error('A choice needs at least one value');
  return {
    expected: `one of ${values.map(shown).join(', ')}`,
    is: (value): value is T => values.some((option) => option === value),
    standIn: first,
  };
}

// ------------------------------------------------------------- the record reader

/** A key nobody can name: what a reader answers for a field the record does not hold. */
const ABSENT: unique symbol = Symbol('absent');

/**
 * A record read field by field, for a decoder written by hand: a file's shell,
 * the project's settings — what no schema describes.
 *
 * Each read answers its field typed, or records the fault at the field's path
 * and answers the check's stand-in, so that the decoder writes its result as
 * one literal whose every property is typed by the read that filled it: a
 * setting added to an interface and never read does not compile. `done` then
 * refuses every key nobody read, and answers the value or every fault.
 *
 * A reader of a record nested in another is made by its parent (`record`), and
 * shares its parent's faults: `done` is asked of the reader made first, once.
 */
export class RecordReader {
  private readonly held: Readonly<Record<string, unknown>> | null;
  /** The keys read so far; `null` until the first. */
  private readKeys: Set<string> | null = null;
  private readAll = false;
  private readonly children: RecordReader[] = [];

  /**
   * `value` read as a record at `path`. When it is none, that is its one fault,
   * and every read of it answers a stand-in with no fault of its own.
   */
  constructor(
    value: unknown,
    private readonly path: DecodePath = [],
    private readonly diagnostics: Diagnostic[] = [],
  ) {
    this.held = isRecord(value) ? value : null;
    if (this.held === null && value !== ABSENT) diagnostics.push(invalid(path, 'an object', value));
  }

  /** The field at `key` if `check` takes it; else its stand-in, the fault recorded. */
  read<T>(key: string, check: Check<T>): T {
    const value = this.take(key);
    if (value === ABSENT) return check.standIn;
    if (check.is(value)) return value;
    this.diagnostics.push(invalid([...this.path, key], check.expected, value));
    return check.standIn;
  }

  /** The record at `key`, to be read in turn. */
  record(key: string): RecordReader {
    const child = new RecordReader(this.take(key), [...this.path, key], this.diagnostics);
    this.children.push(child);
    return child;
  }

  /**
   * The field at `key`, handed to a decoder of its own at its path: its value,
   * or `undefined` with the decoder's faults recorded.
   */
  decode<T>(key: string, decoder: (value: unknown, path: DecodePath) => Decoded<T>): T | undefined {
    const value = this.take(key);
    if (value === ABSENT) return undefined;
    const decoded = decoder(value, [...this.path, key]);
    if (decoded.ok) return decoded.value;
    this.diagnostics.push(...decoded.diagnostics);
    return undefined;
  }

  /** Every key of the record, each counted as read: a record keyed by ids, whose keys are its data. */
  keys(): string[] {
    if (this.held === null) return [];
    this.readAll = true;
    return Object.keys(this.held);
  }

  /** A fault only the decoder can judge — an id that differs from its key — at the field it names. */
  refuse(key: string, code: DiagnosticCode, message: string): void {
    this.diagnostics.push({ code, message, path: [...this.path, key] });
  }

  /** `value`, if nothing read was refused and no key went unread; else every fault, in the order found. */
  done<T>(value: T): Decoded<T> {
    this.refuseUnread();
    return this.diagnostics.length === 0 ? { ok: true, value } : { ok: false, diagnostics: this.diagnostics };
  }

  /** The value at `key`, counted as read; `ABSENT`, its fault recorded, when the record does not hold it. */
  private take(key: string): unknown {
    if (this.held === null) return ABSENT;
    (this.readKeys ??= new Set()).add(key);
    // Its own keys only: a file may name a key `constructor`, which every
    // object answers to without holding it.
    if (Object.hasOwn(this.held, key)) return this.held[key];
    this.diagnostics.push(missing([...this.path, key]));
    return ABSENT;
  }

  private refuseUnread(): void {
    if (this.held !== null && !this.readAll) {
      for (const key of Object.keys(this.held)) {
        if (!this.readKeys?.has(key)) this.diagnostics.push(unexpected([...this.path, key]));
      }
    }
    for (const child of this.children) child.refuseUnread();
  }
}

// ---------------------------------------------------------------- the refusals

/**
 * A text read as JSON: the value, or the one fault that it is none, in the
 * parser's own words. What a file's decoder reads first.
 */
export function decodeJson(text: string): Decoded<unknown> {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, diagnostics: [{ code: 'field.invalid', message: `is not JSON (${reason})`, path: [] }] };
  }
}

/**
 * A file of another format, refused as a whole: one fault, at `version`.
 *
 * A decoder answers it before reading anything else, so an old file gets one
 * line, not one per field that moved since — which would be thousands for a
 * large scene, and would read as damage rather than age.
 */
export function versionRefusal(found: unknown, reads: number): Extract<Decoded<never>, { readonly ok: false }> {
  const written = isUsableNumber(found)
    ? `written in format ${found}`
    : `written in no format this build knows (found ${shown(found)})`;
  return {
    ok: false,
    diagnostics: [
      { code: 'format.version', message: `${written}; this build reads format ${reads} and does not convert it`, path: ['version'] },
    ],
  };
}

/** How many faults a refusal spells out. A file broken ten thousand times says so in a line, not in ten thousand. */
const SPELLED_OUT = 20;

/**
 * A refusal in words: the file, then each fault after its path — the first
 * twenty, then how many more. `file` is the first line: the file's path in the
 * project, or what was read when it is no file.
 */
export function formatDiagnostics(file: string, diagnostics: readonly Diagnostic[]): string {
  const lines = diagnostics
    .slice(0, SPELLED_OUT)
    .map((fault) => (fault.path.length === 0 ? fault.message : `${fault.path.join('.')}: ${fault.message}`));
  if (diagnostics.length > SPELLED_OUT) lines.push(`and ${diagnostics.length - SPELLED_OUT} more`);
  return [file, ...lines].join('\n');
}

/**
 * The value read, or an `Error` carrying the refusal in words: for a caller
 * that cannot go on without the file — a scene switch in a running game, an
 * export — and has nowhere to show diagnostics but the error it raises.
 */
export function unwrap<T>(decoded: Decoded<T>, file: string): T {
  if (decoded.ok) return decoded.value;
  throw new Error(formatDiagnostics(file, decoded.diagnostics));
}
