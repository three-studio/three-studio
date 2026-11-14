import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, type ParserPlugin } from '@babel/parser';
import {
  traverseFast,
  type Comment,
  type File,
  type NewExpression,
  type Node,
  type Program,
  type TSType,
  type VariableDeclarator,
} from '@babel/types';
import { describe, expect, it } from 'vitest';
import { KINDS, RECORD, type Counts, type Kind } from './ratchetRecord';

/*
 * The typing and the state of this repository, counted rather than promised.
 *
 * A type assertion is a claim the compiler takes on trust: `value as SceneDoc`,
 * `rows[0]!`, an `any`, a silenced error. Each is a place where the types say
 * something nobody checked, and that is how a file from disk, a message from a
 * device or a missing array element reaches code that was told it could not
 * happen. Module state is the same trust placed in time: a `let`, a cache or a
 * registry at a module's top level is a dependency no signature shows, shared
 * by every window, every test and every game that imports the file.
 *
 * Neither goes away in a day: the code held some 1 300 assertions and 160
 * pieces of module state when this was written. So they are counted, file by
 * file, and compared with `ratchetRecord.ts` both ways. A count above its
 * record fails, since a count only goes down and a new file starts at zero. A
 * count below its record fails too, until the record is lowered, so that what
 * was cleared stays cleared.
 *
 * It reads syntax, with `@babel/parser`: TypeScript 7 has no compiler API. So
 * there is what it cannot see, and review has to:
 *
 *  - an `any` that a library returns — `JSON.parse`, an IPC `invoke`, a
 *    `MessageEvent`'s `data`. Typing a variable over one is not decoding it,
 *    and no keyword is written for this to count;
 *  - a type predicate or an `asserts` function that checks less than it claims;
 *  - a factory that returns state, a literal that is not empty and is written
 *    to later, a class's `static` field, and a value object used as memory from
 *    one call to the next.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// ------------------------------------------------------------------ the files

const SOURCE_FILE = /\.(?:ts|tsx|mts|cts)$/;
const DECLARATION_FILE = /\.d\.[mc]?ts$/;

/** Folders a build writes, at any depth. */
const BUILD_OUTPUTS: ReadonlySet<string> = new Set(['node_modules', 'dist', 'dist-device', 'out', 'release']);

/**
 * Every TypeScript file under `dir`, as its repository path and its text.
 *
 * Walked from disk rather than from the workspaces' lists, so a new package,
 * module or tool is read the day it appears, and the config files with them.
 * Left out:
 *
 *  - dot-folders and what a build writes;
 *  - `docs/`, which git ignores: its notes and scratch scripts are no part of
 *    the code;
 *  - a folder holding a `.git` entry. A worktree made inside the repository, to
 *    compare this tree with another commit, is another checkout: reading it
 *    would count every file twice.
 *
 * A generator, so that each file's text and tree are dropped once counted.
 */
function* repositorySources(dir: string): Generator<readonly [file: string, source: string]> {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const skipped =
        entry.name.startsWith('.') ||
        BUILD_OUTPUTS.has(entry.name) ||
        (dir === repoRoot && entry.name === 'docs') ||
        existsSync(join(path, '.git'));
      if (!skipped) yield* repositorySources(path);
    } else if (SOURCE_FILE.test(entry.name)) {
      // With `/` on every platform, so the record reads the same on CI's Linux.
      yield [relative(repoRoot, path).split(sep).join('/'), readFileSync(path, 'utf8')];
    }
  }
}

// ------------------------------------------------------------------ the spots

/** One counted construct: its kind, and the text the allow-list knows it by. */
interface Spot {
  readonly kind: Kind;
  readonly text: string;
}

function parsed(file: string, source: string): File {
  // `dts` for a declaration file: without it `export const a: number;` is a
  // `const` with no initializer, and does not parse.
  const typescript: ParserPlugin = ['typescript', { dts: DECLARATION_FILE.test(file) }];
  try {
    return parse(source, {
      sourceType: 'module',
      // JSX for `.tsx` alone: in a `.ts` file `<T>x` is an assertion, not a tag.
      plugins: file.endsWith('.tsx') ? [typescript, 'jsx'] : [typescript],
    });
  } catch (error) {
    // Named, and failing the run: a file left out silently is a file nobody counts.
    throw new Error(`${file} does not parse: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const collapsed = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** `const` in `x as const` and `<const>x`: the one assertion that claims nothing. */
function isConst(type: TSType): boolean {
  return type.type === 'TSTypeReference' && type.typeName.type === 'Identifier' && type.typeName.name === 'const';
}

/**
 * Whether a comment is a directive to the compiler, read as TypeScript reads
 * it: at the opening of a line comment, or of a block comment's last line. A
 * sentence that merely names `@ts-ignore` silences nothing.
 */
function isDirective(comment: Comment): boolean {
  const lastLine = comment.value.slice(comment.value.lastIndexOf('\n') + 1);
  return /^[\s/*]*@ts-(?:ignore|expect-error|nocheck)\b/.test(lastLine);
}

/** Every spot of a file: its assertions as the source has them, then its directives, then its state. */
function spotsIn(ast: File, source: string): Spot[] {
  const spots: Spot[] = [];
  const textOf = (node: Node): string => collapsed(source.slice(node.start ?? 0, node.end ?? 0));

  traverseFast(ast, (node) => {
    switch (node.type) {
      case 'TSAsExpression':
      case 'TSTypeAssertion':
        if (!isConst(node.typeAnnotation)) spots.push({ kind: 'as', text: textOf(node) });
        break;
      case 'TSNonNullExpression':
        spots.push({ kind: 'nonNull', text: textOf(node) });
        break;
      case 'VariableDeclarator':
      case 'ClassProperty':
      case 'ClassPrivateProperty':
        // `let x!: T` and `field!: T` assert as `x!` does: that a value is there.
        if (node.definite) spots.push({ kind: 'nonNull', text: textOf(node) });
        break;
      case 'TSAnyKeyword': {
        // The keyword has no text of its own to tell two apart: its line does.
        const at = node.start ?? 0;
        const end = source.indexOf('\n', at);
        spots.push({
          kind: 'any',
          text: collapsed(source.slice(source.lastIndexOf('\n', at) + 1, end === -1 ? source.length : end)),
        });
        break;
      }
    }
  });
  for (const comment of ast.comments ?? []) {
    if (isDirective(comment)) spots.push({ kind: 'directive', text: collapsed(comment.value) });
  }
  for (const binding of moduleState(ast.program, textOf)) spots.push({ kind: 'state', text: binding });
  return spots;
}

// --------------------------------------------------------------- module state

/*
 * At a module's top level, exported or not, a binding is state when it is:
 *
 *  1. a `let` or a `var`: the binding itself changes;
 *  2. a `const` made by `new`, alone or at the head of a chain
 *     (`new Registry().register(…)`): a registry, a cache, a singleton;
 *  3. a `const` that starts as an empty `[]` or `{}`: a collection made empty
 *     exists to be filled;
 *  4. a `const` made by a store factory: the call of a function imported from
 *     zustand.
 *
 * And it is not, though made by `new` or made empty, when it is:
 *
 *  - the storage of an accessor, a `WeakMap` or a `WeakSet`. What it holds is
 *    collected with its key — a world, an engine, a script — so nothing in it
 *    outlives a lifetime, a test or a window;
 *  - a constant table: a `Map` declared `ReadonlyMap`, a `Set` declared
 *    `ReadonlySet`, an array declared `readonly`. The compiler then refuses
 *    every write, and refuses to hand the table to a mutable type. Not an
 *    object declared `Readonly<…>`: a `Readonly<Record<string, T>>` is
 *    assignable to a `Record<string, T>`, which writes into it with no
 *    assertion at all. An empty `{}` counts whatever its type;
 *  - a value object: one of three's math types, a `RegExp`, a `URL`. It holds
 *    numbers or a pattern, never a dependency or a lifetime, and at module
 *    scope it is a constant or a scratch buffer every use overwrites first —
 *    three's own way of allocating nothing per frame.
 */

/** three's math types the code makes at module scope. Another joins when first made there. */
const MATH_TYPES: ReadonlySet<string> = new Set(['Vector2', 'Vector3', 'Quaternion', 'Euler', 'Matrix4', 'Color']);

/** The declared type that makes a collection a table. */
const TABLE_TYPES: ReadonlyMap<string, string> = new Map([
  ['Map', 'ReadonlyMap'],
  ['Set', 'ReadonlySet'],
]);

interface Imported {
  readonly source: string;
  /** The name it has where it comes from. */
  readonly name: string;
}

/** What each imported binding of a file is, by its local name. */
function importsOf(program: Program): ReadonlyMap<string, Imported> {
  const imports = new Map<string, Imported>();
  for (const statement of program.body) {
    if (statement.type !== 'ImportDeclaration') continue;
    for (const specifier of statement.specifiers) {
      if (specifier.type !== 'ImportSpecifier') continue;
      const { imported } = specifier;
      imports.set(specifier.local.name, {
        source: statement.source.value,
        name: imported.type === 'Identifier' ? imported.name : imported.value,
      });
    }
  }
  return imports;
}

/** An initializer under what only the compiler sees: `as`, `satisfies`, `!`, parentheses. */
function unwrapped(node: Node): Node {
  switch (node.type) {
    case 'TSAsExpression':
    case 'TSTypeAssertion':
    case 'TSSatisfiesExpression':
    case 'TSNonNullExpression':
    case 'ParenthesizedExpression':
      return unwrapped(node.expression);
    default:
      return node;
  }
}

/** What a chain of calls and member reads starts from: `new Registry()` in `new Registry().register(a)`. */
function chainHead(node: Node): Node {
  const inner = unwrapped(node);
  switch (inner.type) {
    case 'CallExpression':
    case 'OptionalCallExpression':
      return chainHead(inner.callee);
    case 'MemberExpression':
    case 'OptionalMemberExpression':
      return chainHead(inner.object);
    default:
      return inner;
  }
}

const referenceName = (type: TSType | null): string | null =>
  type?.type === 'TSTypeReference' && type.typeName.type === 'Identifier' ? type.typeName.name : null;

/** Whether a `new` at module scope makes state, by what it makes and by the type it is declared with. */
function makesState(made: NewExpression, declared: TSType | null, imports: ReadonlyMap<string, Imported>): boolean {
  if (made.callee.type !== 'Identifier') return true;
  const { name } = made.callee;
  if (name === 'WeakMap' || name === 'WeakSet') return false;
  if (TABLE_TYPES.has(name) && TABLE_TYPES.get(name) === referenceName(declared)) return false;
  const imported = imports.get(name);
  // Not imported, so a global: only these two are value objects.
  if (imported === undefined) return name !== 'RegExp' && name !== 'URL';
  const fromThree = imported.source === 'three' || imported.source === 'three/webgpu';
  return !(fromThree && MATH_TYPES.has(imported.name));
}

function isState(declarator: VariableDeclarator, imports: ReadonlyMap<string, Imported>): boolean {
  if (!declarator.init) return false;
  const { id } = declarator;
  const declared =
    id.type === 'Identifier' && id.typeAnnotation?.type === 'TSTypeAnnotation' ? id.typeAnnotation.typeAnnotation : null;
  const init = unwrapped(declarator.init);

  if (init.type === 'ObjectExpression') return init.properties.length === 0;
  if (init.type === 'ArrayExpression') {
    const readonly =
      (declared?.type === 'TSTypeOperator' && declared.operator === 'readonly') ||
      referenceName(declared) === 'ReadonlyArray';
    return init.elements.length === 0 && !readonly;
  }
  const head = chainHead(init);
  if (head.type === 'NewExpression') return makesState(head, declared, imports);
  // A store: `create<State>()(…)`, the call of what zustand exports.
  if (init.type !== 'CallExpression' || head.type !== 'Identifier') return false;
  const source = imports.get(head.name)?.source;
  return source === 'zustand' || source?.startsWith('zustand/') === true;
}

/** The bindings of a module that are state, each by its name. */
function moduleState(program: Program, textOf: (node: Node) => string): string[] {
  const imports = importsOf(program);
  const bindings: string[] = [];
  for (const statement of program.body) {
    const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
    if (declaration?.type !== 'VariableDeclaration') continue;
    const rebindable = declaration.kind === 'let' || declaration.kind === 'var';
    for (const declarator of declaration.declarations) {
      if (!rebindable && !isState(declarator, imports)) continue;
      bindings.push(declarator.id.type === 'Identifier' ? declarator.id.name : textOf(declarator.id));
    }
  }
  return bindings;
}

// ---------------------------------------------------------------- id producers

/*
 * An id's kind cannot be seen at run time, so what makes `string` into an
 * `EntityId` is a check somebody wrote, and a second check would soon disagree
 * with the first about what an id looks like. The checks are type predicates,
 * and they live in one file; code that takes a value from outside calls them.
 * A cast is the other way to make an id, and the ratchet already counts it.
 *
 * What the syntax cannot see: a predicate over a type that holds an id
 * (`x is LaunchSnapshot`). It has to call the checks, and review reads for that.
 */

/** The one file where an id is made or checked. */
const IDS_FILE = 'packages/core/src/ids.ts';

/** The branded id types. The id types of a later kind join when their registry does. */
const ID_TYPES: ReadonlySet<string> = new Set([
  'Id',
  'EntityId',
  'ComponentId',
  'AssetId',
  'SceneId',
  'ComponentTypeId',
  'ImporterId',
]);

function namesAnIdType(type: Node): boolean {
  const names: string[] = [];
  traverseFast(type, (node) => {
    if (node.type === 'TSTypeReference' && node.typeName.type === 'Identifier') names.push(node.typeName.name);
  });
  return names.some((name) => ID_TYPES.has(name));
}

/** The type predicates and `asserts` signatures of a file that name an id type, each by its text. */
function idChecksIn(ast: File, source: string): string[] {
  const checks: string[] = [];
  traverseFast(ast, (node) => {
    if (node.type !== 'TSTypePredicate' || !node.typeAnnotation || !namesAnIdType(node.typeAnnotation)) return;
    checks.push(collapsed(source.slice(node.start ?? 0, node.end ?? 0)));
  });
  return checks;
}

// -------------------------------------------------------------- the allow-list

/**
 * A spot TypeScript truly cannot express, excused for good and with its reason.
 *
 * For the kernel only: inside a decoder, or at the typing gap of a library's
 * adapter. A module that needs one has a defect, and the test says so.
 */
interface AllowedSpot {
  /** The repository path. */
  readonly file: string;
  readonly kind: Kind;
  /** The spot's text, whitespace collapsed. */
  readonly construct: string;
  /** Why TypeScript cannot express it. */
  readonly reason: string;
}

const ALLOWED: readonly AllowedSpot[] = [];

interface Census {
  /** The files that are not at zero. */
  readonly counts: ReadonlyMap<string, Counts>;
  /** The allow-list's entries that excused nothing. */
  readonly unused: readonly AllowedSpot[];
  /** The id checks written outside `ids.ts`, each with its file. */
  readonly idChecks: readonly string[];
}

/** Counts every file's spots, less those the allow-list excuses, and finds its id checks. */
function census(sources: Iterable<readonly [file: string, source: string]>, allowed: readonly AllowedSpot[]): Census {
  const counts = new Map<string, Counts>();
  const used = new Set<AllowedSpot>();
  const idChecks: string[] = [];
  for (const [file, source] of sources) {
    const ast = parsed(file, source);
    if (file !== IDS_FILE) idChecks.push(...idChecksIn(ast, source).map((check) => `${file}: ${check}`));
    const tally: { [K in Kind]?: number } = {};
    for (const spot of spotsIn(ast, source)) {
      const excuse = allowed.find(
        (entry) => entry.file === file && entry.kind === spot.kind && entry.construct === spot.text,
      );
      if (excuse) used.add(excuse);
      else tally[spot.kind] = (tally[spot.kind] ?? 0) + 1;
    }
    if (Object.keys(tally).length > 0) counts.set(file, tally);
  }
  return { counts, unused: allowed.filter((entry) => !used.has(entry)), idChecks };
}

/** What is wrong with the allow-list itself, one line per entry. */
function allowListDefects(allowed: readonly AllowedSpot[], unused: readonly AllowedSpot[]): string[] {
  return [
    ...allowed
      .filter((entry) => entry.file.startsWith('modules/'))
      .map((entry) => `${entry.file}: a spot in a module is a defect, never an exception`),
    // An entry outlives its spot when the code is fixed and the list is not:
    // left there, it would excuse the next assertion written with the same text.
    ...unused.map((entry) => `${entry.file}: nothing reads \`${entry.construct}\` there any more`),
  ];
}

// ------------------------------------------------------------- the comparison

/** The record lines that differ from the code, as they should read. */
interface Mismatch {
  readonly lowered: readonly string[];
  readonly raised: readonly string[];
}

/** A file's line in `RECORD`, its kinds in their fixed order and those at zero left out. */
function recordLine(file: string, counts: Counts): string {
  const kinds = KINDS.flatMap((kind) => (counts[kind] ? [`${kind}: ${counts[kind]}`] : []));
  return `  ['${file}', { ${kinds.join(', ')} }],`;
}

/**
 * Compares what the code holds with the record, both ways, file by file.
 *
 * In two groups, because they call for opposite answers. A lowered count is
 * work done, and its line is pasted. A raised one is an assertion or a piece of
 * state somebody just added, and the answer is to take it out: its line is only
 * ever pasted for a file that moved. Printed apart, a raise cannot ride into the
 * record among forty honest lines. A file with a kind up and another down is
 * raised.
 */
function compareWithRecord(found: ReadonlyMap<string, Counts>, record: ReadonlyMap<string, Counts>): Mismatch {
  const lowered: string[] = [];
  const raised: string[] = [];
  for (const file of [...new Set([...found.keys(), ...record.keys()])].sort()) {
    const now = found.get(file) ?? {};
    const before = record.get(file) ?? {};
    if (KINDS.some((kind) => (now[kind] ?? 0) > (before[kind] ?? 0))) {
      raised.push(recordLine(file, now));
    } else if (!found.has(file)) {
      // At zero, or gone: either way the record holds no line for it.
      lowered.push(`${recordLine(file, before)} // at zero now: remove this line`);
    } else if (KINDS.some((kind) => (now[kind] ?? 0) < (before[kind] ?? 0))) {
      lowered.push(recordLine(file, now));
    }
  }
  return { lowered, raised };
}

/** The failure's message, whole: an assertion's diff would cut the lines to paste short. */
function mismatchMessage({ lowered, raised }: Mismatch): string | null {
  if (lowered.length + raised.length === 0) return null;
  return [
    'test/ratchetRecord.ts no longer says what the code holds.',
    ...(lowered.length > 0 ? ['', 'Lowered — paste each line over its own in RECORD:', ...lowered] : []),
    ...(raised.length > 0
      ? [
          '',
          'Raised — fix the code, not the record: a count only goes down, and a new file starts at zero.',
          'Only a file that moved pastes its line, and removes its old one:',
          ...raised,
        ]
      : []),
  ].join('\n');
}

// ---------------------------------------------------------------- its own tests

const FILE = 'packages/core/src/a.ts';

/** What one source counts, under a path that says how it is parsed. */
function counted(source: string, file = FILE): Counts {
  return census([[file, source]], []).counts.get(file) ?? {};
}

describe('an assertion', () => {
  it('counts `as` and `<T>x`, once for each time it is written', () => {
    expect(counted('const a = b as T;')).toEqual({ as: 1 });
    expect(counted('const a = <T>b;')).toEqual({ as: 1 });
    expect(counted('const a = b as unknown as T;')).toEqual({ as: 2 });
  });

  it('does not count `as const`, `<const>x` or `satisfies`, which claim nothing', () => {
    const source = "const a = ['x'] as const; const b = <const>['y']; const c = { d: 1 } satisfies E;";

    expect(counted(source)).toEqual({});
  });

  it('counts `x!`, and a definite assignment, which asserts as `x!` does', () => {
    const source = 'function f() { let a!: number; return list[0]!.b + a; } class C { d!: string; #e!: number; }';

    expect(counted(source)).toEqual({ nonNull: 4 });
  });

  it('counts `any` wherever it is written', () => {
    expect(counted('function f(a: any): Array<any> { return [a]; }')).toEqual({ any: 2 });
  });

  it('counts a comment that opens with a compiler directive, and none that only names one', () => {
    expect(counted('// @ts-ignore\nf();\n/* @ts-expect-error: the typings are wrong */\ng();')).toEqual({
      directive: 2,
    });
    expect(counted('// @ts-nocheck\nf();')).toEqual({ directive: 1 });
    expect(counted('// Never a @ts-ignore: decode instead.\nf();')).toEqual({});
  });

  it('reads JSX in a `.tsx` file, and a declaration file as one', () => {
    expect(counted('const a = <p>{b as string}</p>;', 'packages/editor/src/A.tsx')).toEqual({ as: 1 });
    expect(counted('export const a: number;\nexport function f(b: any): void;', 'packages/core/src/a.d.ts')).toEqual({
      any: 1,
    });
  });

  it('fails on a file that does not parse, naming it', () => {
    expect(() => counted('const a = ;')).toThrow(/^packages\/core\/src\/a\.ts does not parse: /);
  });
});

describe('module state', () => {
  it('counts a `let` or a `var` at the top level, exported or not', () => {
    expect(counted('let a = 0; var b; export let c = 1, d = 2;')).toEqual({ state: 4 });
  });

  it('counts nothing inside a function or a class', () => {
    const source =
      'function f() { let a = 0; const b = new Map(); const c = []; return [a, b, c]; } class C { static d = new Map(); }';

    expect(counted(source)).toEqual({});
  });

  it('counts a `const` made by `new`, alone or at the head of a chain', () => {
    expect(counted('const a = new Map<string, number>();')).toEqual({ state: 1 });
    expect(counted('export const b = new Registry().register(c).register(d);')).toEqual({ state: 1 });
    expect(counted("const e = new Set(['x']);")).toEqual({ state: 1 });
  });

  it('counts a `const` that starts as an empty collection, whatever it is wrapped in', () => {
    expect(counted('const a: string[] = [];')).toEqual({ state: 1 });
    expect(counted('const a = {};')).toEqual({ state: 1 });
    expect(counted('const a = {} as Record<string, number>;')).toEqual({ as: 1, state: 1 });
    expect(counted('const a = ([] satisfies string[]);')).toEqual({ state: 1 });
  });

  it('counts an empty object declared `Readonly<…>`, which a mutable type still writes through', () => {
    expect(counted('const a: Readonly<Record<string, number>> = {};')).toEqual({ state: 1 });
  });

  it('counts a store: the call of a function imported from zustand', () => {
    const store = 'export const useA = create<A>()((set) => ({ b: 1 }));';

    expect(counted(`import { create } from 'zustand';\n${store}`)).toEqual({ state: 1 });
    expect(counted(`import { create } from './factory';\n${store}`)).toEqual({});
  });

  it('does not count the storage of an accessor: what a WeakMap holds dies with its key', () => {
    expect(counted('const a = new WeakMap<object, number>(); const b = new WeakSet<object>();')).toEqual({});
  });

  it('does not count a table whose declared type forbids writing to it', () => {
    const tables =
      "const a: ReadonlySet<string> = new Set(['x']); const b: ReadonlyMap<string, number> = new Map([['x', 1]]);";

    expect(counted(tables)).toEqual({});
    expect(counted('const a: readonly string[] = []; const b: ReadonlyArray<string> = [];')).toEqual({});
  });

  it('does not count a value object: a math type of three, a RegExp, a URL', () => {
    const vectors =
      "const a = new Vector3(0, 1, 0); const b = new Quaternion().setFromAxisAngle(a, 1); const c = new Color('#fff');";

    expect(
      counted(`import { Quaternion, Vector3 } from 'three/webgpu';\nimport { Color } from 'three';\n${vectors}`),
    ).toEqual({});
    expect(counted("const a = new RegExp('x'); const b = new URL('https://example.com');")).toEqual({});
    expect(counted("import { Vector3 } from './math';\nconst a = new Vector3();")).toEqual({ state: 1 });
  });

  it('does not count a constant: a literal that is not empty, a call, an ambient declaration', () => {
    const source = "const a = ['x']; const b = { c: 1 }; const d = 3; const e = f(); declare const g: number;";

    expect(counted(source)).toEqual({});
  });
});

describe('the allow-list', () => {
  const allow = (construct: string, file = FILE): AllowedSpot => ({ file, kind: 'as', construct, reason: 'a test' });

  it('knows a spot by its text, whitespace collapsed', () => {
    const source = [
      'let memo = 0;',
      'const a = b as',
      '  T;',
      'class C { d!: string }',
      'const e = list[0]!;',
      'function f(g: any) {}',
      '// @ts-ignore  until the typings are fixed',
      'f(e);',
    ].join('\n');

    expect(spotsIn(parsed(FILE, source), source)).toEqual([
      { kind: 'as', text: 'b as T' },
      { kind: 'nonNull', text: 'd!: string' },
      { kind: 'nonNull', text: 'list[0]!' },
      { kind: 'any', text: 'function f(g: any) {}' },
      { kind: 'directive', text: '@ts-ignore until the typings are fixed' },
      { kind: 'state', text: 'memo' },
    ]);
  });

  it('does not count a spot it lists', () => {
    const allowed = [allow('b as T')];
    const found = census([[FILE, 'const a = b as T; const c = d as U;']], allowed);

    expect(found.counts.get(FILE)).toEqual({ as: 1 });
    expect(allowListDefects(allowed, found.unused)).toEqual([]);
  });

  it('fails on an entry that excuses nothing', () => {
    const allowed = [allow('b as T')];
    const found = census([[FILE, 'const a = b;']], allowed);

    expect(allowListDefects(allowed, found.unused)).toEqual([`${FILE}: nothing reads \`b as T\` there any more`]);
  });

  it('fails on an entry in a module: the list is for the kernel', () => {
    const file = 'modules/particles/src/core/index.ts';
    const allowed = [allow('b as T', file)];
    const found = census([[file, 'const a = b as T;']], allowed);

    expect(allowListDefects(allowed, found.unused)).toEqual([
      `${file}: a spot in a module is a defect, never an exception`,
    ]);
  });
});

describe('an id check', () => {
  const checks = (source: string, file = FILE): readonly string[] => census([[file, source]], []).idChecks;

  it('is a type predicate or an `asserts` signature that names an id type', () => {
    expect(checks('function isEntity(value: unknown): value is EntityId { return true; }')).toEqual([
      `${FILE}: value is EntityId`,
    ]);
    expect(checks('function assertAsset(value: unknown): asserts value is AssetId {}')).toEqual([
      `${FILE}: asserts value is AssetId`,
    ]);
    expect(checks("const isId: (key: string) => key is Id<'scene'> = f;")).toEqual([`${FILE}: key is Id<'scene'>`]);
    expect(checks('function f(value: unknown): value is readonly ComponentId[] { return true; }')).toEqual([
      `${FILE}: value is readonly ComponentId[]`,
    ]);
    // A component type's: the built-ins are literals, and an id from outside
    // this build is the branded half, which only a check may claim.
    expect(checks('function f(value: unknown): value is ComponentTypeId { return true; }')).toEqual([
      `${FILE}: value is ComponentTypeId`,
    ]);
    // An importer's, which only a check may claim once one is read from outside.
    expect(checks('function f(value: unknown): value is ImporterId { return true; }')).toEqual([
      `${FILE}: value is ImporterId`,
    ]);
  });

  it('is not a predicate over another type, nor an `asserts` that names none', () => {
    expect(checks('function f(value: unknown): value is SceneEntry { return true; }')).toEqual([]);
    expect(checks('function f(value: unknown): asserts value {}')).toEqual([]);
    expect(checks('function f(value: unknown): EntityId { return g(value); }')).toEqual([]);
  });

  it('is allowed in ids.ts alone, where the form of an id is decided', () => {
    const check = 'export function isEntityId(value: unknown): value is EntityId { return true; }';

    expect(checks(check, 'packages/core/src/ids.ts')).toEqual([]);
    expect(checks(check, 'packages/runtime/src/ids.ts')).toEqual(['packages/runtime/src/ids.ts: value is EntityId']);
  });
});

describe('the comparison with the record', () => {
  const record: ReadonlyMap<string, Counts> = new Map([
    ['a.ts', { as: 3 }],
    ['b.ts', { nonNull: 1 }],
    ['c.ts', { as: 2, state: 1 }],
  ]);

  it('finds nothing to say when the code holds what the record says', () => {
    expect(compareWithRecord(record, record)).toEqual({ lowered: [], raised: [] });
    expect(mismatchMessage({ lowered: [], raised: [] })).toBeNull();
  });

  it('reports a lowered count as the line to paste, and a file gone to zero as the line to remove', () => {
    const found = new Map<string, Counts>([
      ['a.ts', { as: 2 }],
      ['c.ts', { as: 2, state: 1 }],
    ]);

    expect(compareWithRecord(found, record)).toEqual({
      lowered: ["  ['a.ts', { as: 2 }],", "  ['b.ts', { nonNull: 1 }], // at zero now: remove this line"],
      raised: [],
    });
  });

  it('reports a raised count and a new file apart, as they would read', () => {
    const found = new Map<string, Counts>([...record, ['a.ts', { as: 4 }], ['d.ts', { state: 2, any: 1 }]]);

    expect(compareWithRecord(found, record)).toEqual({
      lowered: [],
      raised: ["  ['a.ts', { as: 4 }],", "  ['d.ts', { any: 1, state: 2 }],"],
    });
  });

  it('calls a file raised when one kind went up, whatever went down beside it', () => {
    const found = new Map<string, Counts>([...record, ['c.ts', { as: 1, state: 2 }]]);

    expect(compareWithRecord(found, record)).toEqual({ lowered: [], raised: ["  ['c.ts', { as: 1, state: 2 }],"] });
  });

  it('writes both groups into the failure message, each under what to do with it', () => {
    const message = mismatchMessage({ lowered: ["  ['a.ts', { as: 2 }],"], raised: ["  ['d.ts', { state: 1 }],"] });

    expect(message).toBe(
      [
        'test/ratchetRecord.ts no longer says what the code holds.',
        '',
        'Lowered — paste each line over its own in RECORD:',
        "  ['a.ts', { as: 2 }],",
        '',
        'Raised — fix the code, not the record: a count only goes down, and a new file starts at zero.',
        'Only a file that moved pastes its line, and removes its old one:',
        "  ['d.ts', { state: 1 }],",
      ].join('\n'),
    );
  });
});

// -------------------------------------------------------------- the repository

describe('the repository', () => {
  const found = census(repositorySources(repoRoot), ALLOWED);

  it('holds the assertions and the module state its record says, no more and no fewer', () => {
    const message = mismatchMessage(compareWithRecord(found.counts, RECORD));
    if (message !== null) expect.fail(message);
  });

  it('allow-lists only spots of the kernel that are still there', () => {
    expect(allowListDefects(ALLOWED, found.unused)).toEqual([]);
  });

  it('checks an id nowhere but in ids.ts', () => {
    expect(found.idChecks).toEqual([]);
  });
});
