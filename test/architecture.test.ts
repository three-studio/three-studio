import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import { traverseFast } from '@babel/types';
import { activateCore, assertDefined, createCoreRegistries, isRecord } from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import {
  KERNEL_TSCONFIG_PATHS,
  MODULES,
  MODULE_PARTS,
  WORKSPACE_PACKAGE_NAMES,
  workspaceAliases,
} from '../workspace-aliases';

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
 * and every app, and every tool.
 *
 * Read from disk rather than listed, so a new app is covered the day it appears
 * rather than the day someone remembers this file. A tool has no `src/` and
 * `test/` split — the performance harness is code throughout — so its whole
 * folder is read. It falls in the app layer: it may import everything below.
 * A module is read like a package, and each of its parts falls in its layer.
 */
function scannedRoots(): string[] {
  const packages = WORKSPACE_PACKAGE_NAMES.map((name) => join(repoRoot, 'packages', name));
  const modules = MODULES.map(({ id }) => join(repoRoot, 'modules', id));
  const apps = readdirSync(join(repoRoot, 'apps')).map((name) => join(repoRoot, 'apps', name));
  const tools = readdirSync(join(repoRoot, 'tools')).map((name) => join(repoRoot, 'tools', name));
  return [...[...packages, ...modules, ...apps].flatMap((base) => [join(base, 'src'), join(base, 'test')]), ...tools].filter(
    (dir) => existsSync(dir) && statSync(dir).isDirectory(),
  );
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
  return specifiersIn(readFileSync(file, 'utf8'));
}

/** Every specifier a source imports or re-exports, statically or not. */
function specifiersIn(src: string): string[] {
  const found: string[] = [];
  for (const pattern of [STATIC_IMPORT, DYNAMIC_IMPORT]) {
    const re = new RegExp(pattern.source, pattern.flags);
    for (let m = re.exec(src); m !== null; m = re.exec(src)) {
      found.push(assertDefined(m[1], 'the specifier of a matched import'));
    }
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

/**
 * file -> the files it imports. Both are absolute paths.
 *
 * Declared read-only because it is: built here, once, and only read by the
 * rules below. Without the type, a `new Map` at a module's top level reads as
 * state that somebody fills later, and is counted as such.
 */
const graph: ReadonlyMap<string, readonly string[]> = new Map(
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
  // A module's part sits in the layer it is named after, so the one ordering
  // holds a module's core off the runtime exactly as it holds the kernel's.
  // Its tests, like any test, may reach everything.
  const part = /^modules\/[^/]+\/src\/([^/]+)\//.exec(path)?.[1];
  return LAYERS.find((layer) => layer === part) ?? 'app';
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

  it('lets only packages/runtime/src/physics/ import Rapier', () => {
    // One folder knows the engine, so changing engines one day rewrites that
    // folder and nothing else. A second importer is a second place to rewrite,
    // and a way around the module: a behaviour holding a Rapier body can move it
    // behind the back of whatever the world says drives it. Tests included, so
    // a test reads the solver as a behaviour does, through the module's API.
    const offenders: string[] = [];
    for (const file of files) {
      if (show(file).startsWith('packages/runtime/src/physics/')) continue;
      for (const spec of specifiers(file)) {
        if (spec.startsWith('@dimforge/')) offenders.push(`${show(file)} -> ${spec}`);
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
  // A file is given its low-link when it is first reached, and every file read
  // below has been reached.
  const lowOf = (file: string): number => assertDefined(low.get(file), 'the low-link of a reached file');

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
      const frame = assertDefined(work[work.length - 1], 'the frame on top of the work stack');
      const edges = graph.get(frame.node) ?? [];
      if (frame.next < edges.length) {
        const next = assertDefined(edges[frame.next], 'the next edge of the frame');
        frame.next += 1;
        if (!index.has(next)) {
          index.set(next, counter);
          low.set(next, counter);
          counter += 1;
          stack.push(next);
          onStack.add(next);
          work.push({ node: next, next: 0 });
        } else if (onStack.has(next)) {
          const reachedAt = assertDefined(index.get(next), 'the index of a file on the stack');
          low.set(frame.node, Math.min(lowOf(frame.node), reachedAt));
        }
        continue;
      }

      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent.node, Math.min(lowOf(parent.node), lowOf(frame.node)));
      if (low.get(frame.node) === index.get(frame.node)) {
        const component: string[] = [];
        for (;;) {
          const popped = assertDefined(stack.pop(), 'the file on top of the component stack');
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

  // A component holds at least the file that closed it, so `''` orders nothing.
  return found.sort((a, b) => (a[0] ?? '').localeCompare(b[0] ?? ''));
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
   */
  [
    'packages/editor/src/commands/sceneFiles.ts',
    'packages/editor/src/state/projectStore.ts',
    'packages/editor/src/viewport/EditorViewport.ts',
    // Not a fifth cycle: the knot gained a member when the play cycle came out
    // of `EditorViewport` into a file of its own. `PlaySession` asks which
    // scene is open, which is a fair question for the thing that runs it; the
    // knot is still the store reaching for the viewport.
    'packages/editor/src/viewport/PlaySession.ts',
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

// ----------------------------------------------------------------- the modules

/*
 * A module is `modules/<id>/`: a `package.json` and one folder of `src/` per
 * layer it has a part in. The rules below are what lets one be added or removed
 * by adding or removing that folder, and a line in each root that activates it:
 *
 *  - a part reaches the kernel through its packages' entry points, at or below
 *    its own layer, never a file inside one — an entry point is what the kernel
 *    undertakes to keep, and a deep path is whatever happened to be there;
 *  - a part reaches its own lower parts, and the parts of a module its
 *    `package.json` declares, by their package paths; a relative import stays
 *    inside the part;
 *  - a third-party package is one its `package.json` declares;
 *  - nothing outside the modules imports one, but the roots;
 *  - and no file outside a module names it, or a component type it defines,
 *    but the roots: a kernel that named one would need an edit the day the
 *    module goes.
 *
 * Read from each module's own `package.json`, which is its manifest: its id
 * from its name, the modules and the packages it depends on from its
 * dependencies. There is no second list to keep in step.
 */

interface ModuleManifest {
  readonly id: string;
  /** The parts it has, as folders of its `src/`. */
  readonly parts: readonly string[];
  /** The ids of the modules its `package.json` declares. */
  readonly modules: readonly string[];
  /** The third-party packages its `package.json` declares. */
  readonly packages: readonly string[];
}

const SCOPE = '@three-studio/';
const KERNEL_PACKAGES: readonly string[] = WORKSPACE_PACKAGE_NAMES;
const partDepth = (part: string): number => MODULE_PARTS.findIndex((known) => known === part);

/** A module's manifest, decoded from its `package.json`; what the file gets wrong is reported instead. */
function manifestOf(id: string, parts: readonly string[], json: unknown): ModuleManifest | string {
  if (!isRecord(json)) return `modules/${id}/package.json: is not an object`;
  if (json['name'] !== `${SCOPE}${id}`) return `modules/${id}/package.json: is not named ${SCOPE}${id}`;
  const declared = [json['dependencies'], json['peerDependencies']].flatMap((block) =>
    isRecord(block) ? Object.keys(block) : [],
  );
  return {
    id,
    parts,
    modules: declared.filter((name) => name.startsWith(SCOPE)).map((name) => name.slice(SCOPE.length)),
    packages: declared.filter((name) => !name.startsWith(SCOPE)),
  };
}

/** The package a bare specifier names: `three/webgpu` is `three`, `@scope/name/deep` is `@scope/name`. */
function packageOf(spec: string): string {
  const segments = spec.split('/');
  return (spec.startsWith('@') ? segments.slice(0, 2) : segments.slice(0, 1)).join('/');
}

/** What the import rules of the modules find wrong in these files, a line each. */
function moduleImportProblems(
  modules: readonly ModuleManifest[],
  roots: ReadonlySet<string>,
  sources: readonly (readonly [path: string, source: string])[],
): string[] {
  const problems: string[] = [];
  const ids = new Set(modules.map((module) => module.id));

  for (const [path, source] of sources) {
    const [, ownerId, part] = /^modules\/([^/]+)\/src\/([^/]+)\//.exec(path) ?? [];
    const owner = modules.find((module) => module.id === ownerId);
    const inModule = path.startsWith('modules/');

    for (const spec of specifiersIn(source)) {
      const [, scoped, rest] = /^@three-studio\/([^/]+)(?:\/(.*))?$/.exec(spec) ?? [];
      const namesModule = scoped !== undefined && ids.has(scoped);

      // Outside the modules, only a root imports one.
      if (!inModule) {
        if (namesModule && !roots.has(path)) problems.push(`${path}: imports the module ${scoped}, and is no composition root`);
        continue;
      }
      // A module's tests are tests: they may reach what they check.
      if (owner === undefined || part === undefined) continue;

      if (spec.startsWith('.')) {
        const target = join(dirname(path), spec);
        if (!target.startsWith(`modules/${owner.id}/src/${part}/`)) problems.push(`${path}: ${spec} leaves its part`);
      } else if (scoped !== undefined && KERNEL_PACKAGES.includes(scoped)) {
        if (rest !== undefined) problems.push(`${path}: ${spec} reaches past the entry point of ${SCOPE}${scoped}`);
        else if (partDepth(scoped) > partDepth(part)) problems.push(`${path}: ${spec} is above its layer`);
      } else if (namesModule) {
        const lower = rest !== undefined && partDepth(rest) >= 0 && partDepth(rest) <= partDepth(part);
        if (scoped === owner.id) {
          if (rest === part || !lower) problems.push(`${path}: ${spec} is not one of its own lower parts`);
        } else if (!owner.modules.includes(scoped ?? '')) {
          problems.push(`${path}: ${spec} is a module its package.json does not declare`);
        } else if (!lower) {
          problems.push(`${path}: ${spec} is above its layer`);
        }
      } else if (!spec.startsWith('node:') && !owner.packages.includes(packageOf(spec))) {
        problems.push(`${path}: ${spec} is a package its package.json does not declare`);
      }
    }
  }
  return problems;
}

/**
 * The files that name what belongs to a module, a line each.
 *
 * `names` are the module ids and the ids of the component types they define.
 * Read as syntax, not as text: an identifier or a string equal to one. A
 * comment may say "particles", and a word that merely contains one is another
 * word.
 */
function moduleNameProblems(
  names: ReadonlySet<string>,
  roots: ReadonlySet<string>,
  sources: readonly (readonly [path: string, source: string])[],
): string[] {
  const problems: string[] = [];
  for (const [path, source] of sources) {
    if (path.startsWith('modules/') || roots.has(path)) continue;
    const named = new Set<string>();
    const ast = parse(source, { sourceType: 'module', plugins: path.endsWith('.tsx') ? ['typescript', 'jsx'] : ['typescript'] });
    traverseFast(ast, (node) => {
      if ((node.type === 'Identifier' || node.type === 'JSXIdentifier') && names.has(node.name)) named.add(node.name);
      if (node.type === 'StringLiteral' && names.has(node.value)) named.add(node.value);
      if (node.type === 'TemplateElement' && names.has(node.value.raw)) named.add(node.value.raw);
    });
    for (const name of [...named].sort()) problems.push(`${path}: names ${name}, which belongs to a module`);
  }
  return problems;
}

/** The modules on disk, each read from its `package.json`, with what a manifest gets wrong. */
function modulesOnDisk(): { modules: ModuleManifest[]; problems: string[] } {
  const modules: ModuleManifest[] = [];
  const problems: string[] = [];
  for (const { id, parts } of MODULES) {
    const json: unknown = JSON.parse(readFileSync(join(repoRoot, 'modules', id, 'package.json'), 'utf8'));
    const manifest = manifestOf(id, parts, json);
    if (typeof manifest === 'string') problems.push(manifest);
    else modules.push(manifest);
  }
  return { modules, problems };
}

/**
 * The ids of the component types a module defines: what its core part
 * registers, into registries the kernel has already filled. Asked of the module
 * itself, so that no list here has to know them.
 */
async function typeIdsOf(module: ModuleManifest): Promise<string[]> {
  if (!module.parts.includes('core')) return [];
  const part: unknown = await import(join(repoRoot, 'modules', module.id, 'src/core/index.ts'));
  const activate = isRecord(part) ? part['activate'] : undefined;
  if (typeof activate !== 'function') return [];
  const registries = createCoreRegistries();
  activateCore(registries);
  const kernel = new Set<string>(registries.components.values().map(({ id }) => id));
  activate(registries);
  return registries.components.values().map(({ id }) => id).filter((id) => !kernel.has(id));
}

// ------------------------------------------------------- the composition roots

/*
 * Where an app's registries are made and filled, and the only places: the
 * editor's window, which is the launcher's too; the player, which the device
 * page runs as well; and the desktop main process. Each with the layers it
 * builds, whose activations it has to call. Named once, here.
 *
 * A library function that made registries of its own would hold an app context
 * no root activated and no test can hand in — the module state the registries
 * replaced, under another name. And a root that took a hot update would
 * register a second time into registries that refuse it: an edit to anything a
 * root activates reloads the window instead, which is what Vite does when no
 * module on the way accepts the update.
 */
const ROOTS: ReadonlyMap<string, readonly ('Core' | 'Runtime' | 'Editor')[]> = new Map([
  ['apps/desktop/src/renderer/src/main.tsx', ['Core', 'Runtime', 'Editor']],
  ['apps/web-template/src/main.ts', ['Core', 'Runtime']],
  ['apps/desktop/src/main/index.ts', ['Core']],
]);

/** Where else registries may be made: the three files that declare them, the tools, and the tests. */
function mayMakeRegistries(path: string): boolean {
  return (
    ROOTS.has(path) ||
    path === 'packages/core/src/registries.ts' ||
    path === 'packages/runtime/src/registries.ts' ||
    path === 'packages/editor/src/registries.ts' ||
    path.startsWith('tools/') ||
    /(^|\/)test\//.test(path)
  );
}

const MAKES_REGISTRIES = /\bcreate(?:Core|Runtime|Editor)Registries\(/;

/**
 * What the rules of the roots find wrong in these files, a line each.
 *
 * A root activates every module too, part by part: each part of a layer the
 * root builds, imported whole (`import * as sparksCore from …`) and activated
 * after the kernel's own activation of that layer, since a module registers
 * into what the kernel has filled. A module no root activates would be a folder
 * that does nothing, with no error anywhere.
 */
function rootProblems(
  sources: readonly (readonly [path: string, source: string])[],
  modules: readonly ModuleManifest[] = [],
): string[] {
  const problems: string[] = [];
  for (const [path, source] of sources) {
    if (!mayMakeRegistries(path) && MAKES_REGISTRIES.test(source)) {
      problems.push(`${path}: makes registries, and is no composition root`);
    }
    const layers = ROOTS.get(path);
    if (layers === undefined) continue;
    for (const layer of layers) {
      if (!source.includes(`activate${layer}(`)) problems.push(`${path}: never calls activate${layer}`);
      const part = layer.toLowerCase();
      for (const module of modules.filter((candidate) => candidate.parts.includes(part))) {
        const spec = `${SCOPE}${module.id}/${part}`;
        const name = new RegExp(`import \\* as (\\w+) from '${spec}'`).exec(source)?.[1];
        const activated = name === undefined ? -1 : source.indexOf(`${name}.activate(`);
        if (activated === -1) problems.push(`${path}: never activates ${spec}`);
        else if (activated < source.indexOf(`activate${layer}(`)) {
          problems.push(`${path}: activates ${spec} before the kernel's own ${part}`);
        }
      }
    }
    if (source.includes('import.meta.hot')) problems.push(`${path}: reads import.meta.hot`);
  }
  return problems;
}

describe('the composition roots', () => {
  it('reports a library file that makes registries', () => {
    expect(rootProblems([['packages/editor/src/panel.ts', 'const own = createRuntimeRegistries();']])).toEqual([
      'packages/editor/src/panel.ts: makes registries, and is no composition root',
    ]);
  });

  it('reports a root that leaves a layer it builds unactivated', () => {
    const root = 'const registries = createRuntimeRegistries();\nactivateCore(registries);\n';
    expect(rootProblems([['apps/web-template/src/main.ts', root]])).toEqual([
      'apps/web-template/src/main.ts: never calls activateRuntime',
    ]);
  });

  it('reports an editor window that leaves the editor\'s own parts unactivated', () => {
    const root = 'const registries = createEditorRegistries();\nactivateCore(registries);\nactivateRuntime(registries);\n';
    expect(rootProblems([['apps/desktop/src/renderer/src/main.tsx', root]])).toEqual([
      'apps/desktop/src/renderer/src/main.tsx: never calls activateEditor',
    ]);
  });

  it('reports a root that reads import.meta.hot', () => {
    const root = 'activateCore(registries);\nimport.meta.hot?.accept();\n';
    expect(rootProblems([['apps/desktop/src/main/index.ts', root]])).toEqual([
      'apps/desktop/src/main/index.ts: reads import.meta.hot',
    ]);
  });

  it('finds none in the tree: only the roots, the tools and the tests make registries', () => {
    // A root that moved would match nothing and pass every rule: it is looked
    // for first.
    const scanned = files.map(show);
    for (const root of ROOTS.keys()) expect(scanned).toContain(root);

    expect(rootProblems(files.map((file) => [show(file), readFileSync(file, 'utf8')]), modulesOnDisk().modules)).toEqual([]);
  });

  it('reports a root that leaves a module\'s part unactivated, or activates it before the kernel\'s', () => {
    const sparks: ModuleManifest = { id: 'sparks', parts: ['core', 'runtime'], modules: [], packages: [] };
    const root = (body: string): string[] => rootProblems([['apps/web-template/src/main.ts', body]], [sparks]);
    const imports =
      "import * as sparksCore from '@three-studio/sparks/core';\nimport * as sparksRuntime from '@three-studio/sparks/runtime';\n";

    expect(root(`${imports}activateCore(r);\nsparksCore.activate(r);\nactivateRuntime(r);\nsparksRuntime.activate(r);\n`)).toEqual([]);
    expect(root(`${imports}activateCore(r);\nsparksCore.activate(r);\nactivateRuntime(r);\n`)).toEqual([
      'apps/web-template/src/main.ts: never activates @three-studio/sparks/runtime',
    ]);
    expect(root(`${imports}sparksCore.activate(r);\nactivateCore(r);\nactivateRuntime(r);\nsparksRuntime.activate(r);\n`)).toEqual([
      "apps/web-template/src/main.ts: activates @three-studio/sparks/core before the kernel's own core",
    ]);
  });
});

describe('the modules', () => {
  // Two made-up modules, so that each rule is shown to bite whatever the tree holds.
  const sparks: ModuleManifest = { id: 'sparks', parts: ['core', 'runtime', 'editor'], modules: ['trails'], packages: ['three'] };
  const trails: ModuleManifest = { id: 'trails', parts: ['core', 'runtime'], modules: [], packages: [] };
  const roots: ReadonlySet<string> = new Set(['apps/player/src/main.ts']);
  const found = (path: string, source: string): string[] => moduleImportProblems([sparks, trails], roots, [[path, source]]);

  it('lets a part import the kernel by its entry points, its own lower parts, a declared module and a declared package', () => {
    const part = [
      "import { defineSystem } from '@three-studio/runtime';",
      "import type { EntityId } from '@three-studio/core';",
      "import { sparkType } from '@three-studio/sparks/core';",
      "import { trailType } from '@three-studio/trails/core';",
      "import { Mesh } from 'three/webgpu';",
      "import { sprite } from './sprite';",
    ].join('\n');

    expect(found('modules/sparks/src/runtime/index.ts', part)).toEqual([]);
  });

  it('reports a part that reaches past a kernel entry point', () => {
    expect(found('modules/sparks/src/core/index.ts', "import { planFields } from '@three-studio/core/fieldSchema';")).toEqual([
      'modules/sparks/src/core/index.ts: @three-studio/core/fieldSchema reaches past the entry point of @three-studio/core',
    ]);
  });

  it('reports a part that reaches above its layer: the kernel\'s, its own, another module\'s', () => {
    expect(found('modules/sparks/src/core/index.ts', "import { Engine } from '@three-studio/runtime';")).toEqual([
      'modules/sparks/src/core/index.ts: @three-studio/runtime is above its layer',
    ]);
    expect(found('modules/sparks/src/runtime/index.ts', "import { pane } from '@three-studio/sparks/editor';")).toEqual([
      'modules/sparks/src/runtime/index.ts: @three-studio/sparks/editor is not one of its own lower parts',
    ]);
    expect(found('modules/sparks/src/core/index.ts', "import { trail } from '@three-studio/trails/runtime';")).toEqual([
      'modules/sparks/src/core/index.ts: @three-studio/trails/runtime is above its layer',
    ]);
  });

  it('reports a relative import that leaves its part', () => {
    expect(found('modules/sparks/src/runtime/system.ts', "import { sparkType } from '../core/index';")).toEqual([
      'modules/sparks/src/runtime/system.ts: ../core/index leaves its part',
    ]);
  });

  it('reports a module, and a package, its package.json does not declare', () => {
    expect(found('modules/trails/src/core/index.ts', "import { sparkType } from '@three-studio/sparks/core';")).toEqual([
      'modules/trails/src/core/index.ts: @three-studio/sparks/core is a module its package.json does not declare',
    ]);
    expect(found('modules/trails/src/runtime/index.ts', "import { Mesh } from 'three/webgpu';")).toEqual([
      'modules/trails/src/runtime/index.ts: three/webgpu is a package its package.json does not declare',
    ]);
  });

  it('reports a file that imports a module and is no root, in the kernel or in an app', () => {
    const importing = "import * as sparksCore from '@three-studio/sparks/core';";

    expect(found('packages/runtime/src/Engine.ts', importing)).toEqual([
      'packages/runtime/src/Engine.ts: imports the module sparks, and is no composition root',
    ]);
    expect(found('apps/player/src/loading.ts', importing)).toEqual([
      'apps/player/src/loading.ts: imports the module sparks, and is no composition root',
    ]);
    expect(found('apps/player/src/main.ts', importing)).toEqual([]);
  });

  it('reports a manifest that is not named after its folder', () => {
    expect(manifestOf('sparks', ['core'], { name: '@three-studio/sparkles' })).toBe(
      'modules/sparks/package.json: is not named @three-studio/sparks',
    );
    expect(manifestOf('sparks', ['core'], { name: '@three-studio/sparks', dependencies: { '@three-studio/trails': '*' }, peerDependencies: { three: '^0.185.0' } })).toEqual({
      id: 'sparks',
      parts: ['core'],
      modules: ['trails'],
      packages: ['three'],
    });
  });

  it('reports a file that names a module or one of its types, and is neither the module nor a root', () => {
    const names: ReadonlySet<string> = new Set(['sparks', 'sparkEmitter']);
    const named = (path: string, source: string): string[] => moduleNameProblems(names, roots, [[path, source]]);

    expect(named('packages/editor/src/icons.ts', "const ICONS = { sparkEmitter: Sparkles };\nrank('sparks');")).toEqual([
      'packages/editor/src/icons.ts: names sparkEmitter, which belongs to a module',
      'packages/editor/src/icons.ts: names sparks, which belongs to a module',
    ]);
    // A comment may say it, and a longer word is another word.
    expect(named('packages/runtime/src/Engine.ts', '// GPU culling, sparks and trails\nconst sparksPerFrame = 3;')).toEqual([]);
    expect(named('modules/sparks/src/core/index.ts', "const id = 'sparkEmitter';")).toEqual([]);
    expect(named('apps/player/src/main.ts', 'sparks.activate(registries);')).toEqual([]);
  });

  it('finds none in the tree: every module keeps to its parts, and nothing but the roots knows one', async () => {
    const { modules, problems } = modulesOnDisk();
    const roots: ReadonlySet<string> = new Set(ROOTS.keys());
    const sources = files.map((file) => [show(file), readFileSync(file, 'utf8')] as const);
    // The repository's own tests are read for names too: a rule that listed a
    // module's type would be an edit the day the module goes.
    const rootTests = sourceFiles(join(repoRoot, 'test')).map((file) => [show(file), readFileSync(file, 'utf8')] as const);
    const names = new Set(modules.map((module) => module.id));
    for (const module of modules) for (const id of await typeIdsOf(module)) names.add(id);

    expect(problems).toEqual([]);
    expect(moduleImportProblems(modules, roots, sources)).toEqual([]);
    expect(moduleNameProblems(names, roots, [...sources, ...rootTests])).toEqual([]);
  });
});

describe('the kernel alone', () => {
  it('is what tsconfig.kernel.json compiles: every package, their paths, and no module', () => {
    // `npm run typecheck` compiles this config after the whole repository's. A
    // kernel file that reached a module would not resolve there — as long as
    // the config holds the packages and nothing else, which is what is held here.
    const config: unknown = JSON.parse(readFileSync(join(repoRoot, 'tsconfig.kernel.json'), 'utf8'));
    const options = isRecord(config) ? config['compilerOptions'] : undefined;

    expect(isRecord(options) ? options['paths'] : undefined).toEqual(KERNEL_TSCONFIG_PATHS);
    expect(isRecord(config) ? config['include'] : undefined).toEqual([
      'packages/*/src/**/*.ts',
      'packages/*/src/**/*.tsx',
      'packages/*/test/**/*.ts',
    ]);
  });
});
