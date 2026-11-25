import { SCRIPT_API_VERSION, isAssetId, isRecord, type AssetId } from '@three-studio/core';
import { Behaviour, type ScriptProperties } from './ScriptApi';

/** Constructor shape a compiled script module must default-export. */
export interface ScriptClass {
  new (): Behaviour;
  properties?: ScriptProperties;
}

/**
 * The classes of one compiled script bundle, by the asset id of each script.
 *
 * A bundle's own, handed to the world that runs it: two worlds given two
 * bundles each run their own, where a table of the page's, filled by whichever
 * bundle was imported last, was every world's at once.
 */
export type ScriptClasses = ReadonlyMap<AssetId, ScriptClass>;

/** A project with no scripts, or a bundle that failed: nothing to run. */
export const NO_SCRIPTS: ReadonlyMap<AssetId, ScriptClass> = new Map();

/**
 * Puts on the page the API a compiled bundle's shim reads.
 *
 * Published on a global rather than imported, because the bundle must not pull
 * its own copy of the runtime — that would mean a second three.js in memory and
 * `instanceof` failing across the boundary. The build resolves
 * `@three-studio/runtime` to a shim that reads this, and checks its version.
 */
export function publishScriptApi(): void {
  Reflect.set(globalThis, '__STUDIO_SCRIPT_API__', { version: SCRIPT_API_VERSION, Behaviour });
}

/**
 * Whether a value is a script's class: a function whose instances are
 * `Behaviour`s.
 *
 * A default export that is a function and nothing more — a helper's
 * `export default function lerp` — is not one. Taken for one, it failed at its
 * first hook.
 */
export function isScriptClass(value: unknown): value is ScriptClass {
  return typeof value === 'function' && value.prototype instanceof Behaviour;
}

/**
 * What a compiled bundle exports: each pair of `scripts` whose id is an asset
 * id and whose class extends `Behaviour`.
 *
 * A bundle is a build of the author's code, and what `import()` hands back is
 * whatever it holds, so it is decoded here rather than trusted. Anything else
 * is dropped, as a helper's export always was.
 */
export function scriptClassesOf(bundle: unknown): ScriptClasses {
  const scripts = isRecord(bundle) ? bundle['scripts'] : undefined;
  if (!Array.isArray(scripts)) return NO_SCRIPTS;
  const classes = new Map<AssetId, ScriptClass>();
  for (const pair of scripts) {
    if (!Array.isArray(pair)) continue;
    const [assetId, scriptClass]: unknown[] = pair;
    if (isAssetId(assetId) && isScriptClass(scriptClass)) classes.set(assetId, scriptClass);
  }
  return classes;
}
