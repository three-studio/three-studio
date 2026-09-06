import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WORKSPACE_PACKAGE_NAMES, workspaceAliases } from '../workspace-aliases';

/*
 * The layering, asserted rather than documented.
 *
 * These rules are cheap to keep and expensive to restore once broken: they are
 * what makes "export to web" a plain bundle of @three-studio/runtime rather than
 * a refactor, and what lets `packages/core` be published on its own.
 *
 * This replaces a regex scan that looked at `packages/{core,runtime}/src` and
 * nothing else. What it could not see, it did not report: whether the editor
 * reaches into `apps/`, whether `core` reaches into `runtime`, and — because a
 * text scan has no graph — any import cycle at all. There were four.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// ---------------------------------------------------------------- the sources

/**
 * Every directory the rules cover: the source *and* the tests of every package
 * and every app.
 *
 * Read from disk rather than listed, so a new app is covered the day it appears
 * rather than the day someone remembers this file.
 */
function scannedRoots(): string[] {
  const packages = WORKSPACE_PACKAGE_NAMES.map((name) => join(repoRoot, 'packages', name));
  const apps = readdirSync(join(repoRoot, 'apps')).map((name) => join(repoRoot, 'apps', name));
  return [...packages, ...apps]
    .flatMap((base) => [join(base, 'src'), join(base, 'test')])
    .filter((dir) => existsSync(dir));
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const files = scannedRoots().flatMap(sourceFiles).sort();

// ------------------------------------------------------------ the specifiers

/*
 * A static `import`/`export … from`, anchored to the start of its line.
 *
 * The anchor is the whole guard, and it replaces a subtler one. The scan this
 * came from matched anywhere after whitespace, so it read module specifiers out
 * of ordinary strings: five of them in this repo, including the two template
 * literals in `apps/desktop/src/main/scripts.ts` that *generate* a user script —
 * which made the desktop app look like it imported `@three-studio/runtime` when
 * it only prints that line into someone else's bundle — and a comment in
 * `Reconciler.ts` reading `… from "nothing built yet"`. A declaration can only
 * appear at the top of a statement, so requiring it to open its line costs
 * nothing and ends the whole category.
 *
 * `[^'";]*?` spans the `{ … }` clause and any newlines inside it, and stops at
 * the first quote — which, in a declaration, is always the specifier.
 */
const STATIC_IMPORT = /^[ \t]*(?:import|export)\s+(?:[^'";]*?\bfrom\s*)?['"]([^'"]+)['"]/gm;

/** `import('…')`. A deferred edge is still an edge. */
const DYNAMIC_IMPORT = /\bimport\s*\(\s*['"]([^'"]+)['"]/g;

function specifiers(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const found: string[] = [];
  for (const pattern of [STATIC_IMPORT, DYNAMIC_IMPORT]) {
    const re = new RegExp(pattern.source, pattern.flags);
    for (let m = re.exec(src); m !== null; m = re.exec(src)) found.push(m[1]!);
  }
  return found;
}

// ------------------------------------------------------------- the resolution

/** What a bundler tries, in order, for a specifier that named no extension. */
const CANDIDATES = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

function existingFile(base: string): string | null {
  for (const suffix of CANDIDATES) {
    const path = base + suffix;
    if (existsSync(path) && statSync(path).isFile()) return path;
  }
  return null;
}

/*
 * Vite's `@` alias for the desktop renderer, which is the one alias not in
 * `workspace-aliases.ts` because it is local to that app. It is mirrored here
 * rather than shared: a root module has no business holding a path inside one
 * app. See `apps/desktop/electron.vite.config.ts`.
 */
const RENDERER_ALIAS = {
  find: /^@\/(.*)$/,
  replacement: join(repoRoot, 'apps/desktop/src/renderer/src', '$1'),
};

type Resolution =
  | { kind: 'file'; path: string }
  /** A package, or a file that is not code — a stylesheet. Not a node. */
  | { kind: 'external' }
  | { kind: 'unresolved' };

/**
 * Where a specifier points, by the same rules the bundlers use.
 *
 * The workspace aliases are applied exactly as `vitest.config.ts` and the two
 * Vite configs apply them — the same array, `$1` and all — so this graph cannot
 * drift from what actually gets bundled.
 */
function resolveSpecifier(from: string, spec: string): Resolution {
  let base: string | null = null;
  if (spec.startsWith('.')) base = resolve(dirname(from), spec);
  else {
    for (const alias of [...workspaceAliases, RENDERER_ALIAS]) {
      if (alias.find.test(spec)) {
        base = spec.replace(alias.find, alias.replacement);
        break;
      }
    }
  }
  // A bare specifier: three, react, node:fs. Nothing this file has to say.
  if (base === null) return { kind: 'external' };

  const path = existingFile(base);
  if (path === null) return { kind: 'unresolved' };
  return /\.tsx?$/.test(path) ? { kind: 'file', path } : { kind: 'external' };
}

/** file -> the files it imports. Both are absolute paths. */
const graph = new Map<string, string[]>(
  files.map((file) => [
    file,
    [
      ...new Set(
        specifiers(file)
          .map((spec) => resolveSpecifier(file, spec))
          .flatMap((hit) => (hit.kind === 'file' ? [hit.path] : [])),
      ),
    ],
  ]),
);

const show = (file: string): string => relative(repoRoot, file);

// ----------------------------------------------------------------- the layers

/*
 * Lower may not reach higher. That single ordering is the four rules at once:
 * core reaches neither runtime nor the editor nor an app, runtime reaches
 * neither the editor nor an app, and the editor reaches no app.
 *
 * Nothing is said about one app reaching another, because nothing has ever
 * needed to say it. A rule with no violation to prevent is a rule that gets
 * deleted the first time it is inconvenient.
 */
const LAYERS = ['core', 'runtime', 'editor', 'app'] as const;
type Layer = (typeof LAYERS)[number];

function layerOf(file: string): Layer {
  const path = show(file);
  for (const layer of LAYERS) {
    if (path.startsWith(`packages/${layer}/`)) return layer;
  }
  return 'app';
}

const depth = (layer: Layer): number => LAYERS.indexOf(layer);

describe('the layers only ever point downwards', () => {
  it('has no import from a lower layer into a higher one', () => {
    const offenders: string[] = [];
    for (const [file, imports] of graph) {
      const from = layerOf(file);
      for (const target of imports) {
        const to = layerOf(target);
        if (depth(to) > depth(from)) {
          offenders.push(`${from}: ${show(file)} -> ${to}: ${show(target)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps core dependency-free, not merely workspace-free', () => {
    // Stronger than the layer rule and separate from it: core's source may name
    // nothing but a relative path and `node:`. Its published build resolves
    // through node_modules like any consumer's would, so a third-party import
    // here is a dependency someone else has to install.
    const allowed = /^(\.|node:)/;
    const offenders: string[] = [];
    for (const file of files) {
      if (!show(file).startsWith('packages/core/src/')) continue;
      for (const spec of specifiers(file)) {
        if (!allowed.test(spec)) offenders.push(`${show(file)} -> ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('resolves every import it claims to have read', () => {
    // The graph is only worth its assertions if it is complete. A specifier that
    // looks internal and resolves to nothing is either a broken import or a hole
    // in the resolver above, and both are worth failing over.
    const offenders: string[] = [];
    for (const file of files) {
      for (const spec of specifiers(file)) {
        if (resolveSpecifier(file, spec).kind === 'unresolved') {
          offenders.push(`${show(file)} -> ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ----------------------------------------------------------------- the cycles

/**
 * Every knot in the graph: Tarjan's strongly connected components, plus the file
 * that imports itself. Iterative rather than recursive, so that how deep the
 * import graph gets is never a question about the call stack.
 *
 * A component rather than a path, because a component is stable. The path a
 * traversal happens to take through a knot changes with the order the files are
 * read; the set of files in the knot does not. That is what makes the list below
 * something to compare against rather than something to keep re-recording.
 */
function cycles(): string[][] {
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const found: string[][] = [];

  for (const start of files) {
    if (index.has(start)) continue;
    // Each frame remembers how far through its own edge list it has walked.
    const work: { node: string; next: number }[] = [{ node: start, next: 0 }];
    index.set(start, counter);
    low.set(start, counter);
    counter += 1;
    stack.push(start);
    onStack.add(start);

    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const edges = graph.get(frame.node) ?? [];
      if (frame.next < edges.length) {
        const next = edges[frame.next]!;
        frame.next += 1;
        if (!index.has(next)) {
          index.set(next, counter);
          low.set(next, counter);
          counter += 1;
          stack.push(next);
          onStack.add(next);
          work.push({ node: next, next: 0 });
        } else if (onStack.has(next)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, index.get(next)!));
        }
        continue;
      }

      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent.node, Math.min(low.get(parent.node)!, low.get(frame.node)!));
      if (low.get(frame.node) === index.get(frame.node)) {
        const component: string[] = [];
        for (;;) {
          const popped = stack.pop()!;
          onStack.delete(popped);
          component.push(popped);
          if (popped === frame.node) break;
        }
        // A file importing itself is a component of one, and it is still a
        // cycle — a barrel that re-exports itself is the usual way it happens.
        const selfImport = (graph.get(frame.node) ?? []).includes(frame.node);
        if (component.length > 1 || selfImport) found.push(component.map(show).sort());
      }
    }
  }

  return found.sort((a, b) => a[0]!.localeCompare(b[0]!));
}

/*
 * The cycles that exist today, named so that a fourth one cannot arrive quietly.
 *
 * This list is debt, not permission. Each is closed by a task in this refactor,
 * and each entry goes away with it — the test fails on a cycle that is gone
 * just as loudly as on a new one, which is what keeps the list honest. One has
 * gone that way already: `assetField` reached into the import store to open a
 * dialog and into the dock to raise a panel, and both are handed to it now.
 *
 * Ordered by first path, which is how `cycles()` returns them.
 */
const KNOWN_CYCLES: string[][] = [
  /*
   * Two modules of one import pipeline, closed by `import type` in the one
   * direction that would otherwise be a load-order problem. Erased at compile
   * time, so it has never cost anything at runtime — which is exactly why it
   * survived unnoticed.
   */
  [
    'apps/desktop/src/main/import/ImportPipeline.ts',
    'apps/desktop/src/main/import/ImportSession.ts',
  ],
  /*
   * viewportHost -> EditorViewport -> sceneFiles -> projectStore -> viewportHost.
   * The only one of the four that is a real cycle of values, and it closes on a
   * layer violation: `state/projectStore.ts` imports the viewport to call
   * `peekViewport()?.binder.setAssetResolver(...)`. A store owns no renderer.
   * Closed in lot 4.
   */
  [
    'packages/editor/src/commands/sceneFiles.ts',
    'packages/editor/src/state/projectStore.ts',
    'packages/editor/src/viewport/EditorViewport.ts',
    'packages/editor/src/viewport/viewportHost.ts',
  ],
  /*
   * The preview surfaces and the surface they share. The three previews take
   * only the type; `PreviewSurface` reaches back with a dynamic `import()`,
   * which is also why `ModelPreview` is a chunk of its own in the build.
   */
  [
    'packages/editor/src/import/preview/AudioPreview.ts',
    'packages/editor/src/import/preview/ImagePreview.ts',
    'packages/editor/src/import/preview/ModelPreview.ts',
    'packages/editor/src/import/preview/PreviewSurface.ts',
  ],
];

describe('import cycles', () => {
  it('has exactly the three this refactor is here to remove', () => {
    expect(cycles()).toEqual(KNOWN_CYCLES);
  });
});
