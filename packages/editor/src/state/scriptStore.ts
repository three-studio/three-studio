import { SCRIPT_API_VERSION } from '@three-studio/core';
import {
  Behaviour,
  clearScripts,
  registerScript,
  scriptClassFor,
  type ScriptPropertyDef,
} from '@three-studio/runtime';
import { create } from 'zustand';

interface ScriptState {
  building: boolean;
  errors: string[];
  warnings: string[];
  /** Bumped after each successful build so the inspector re-reads properties. */
  revision: number;

  build: () => Promise<boolean>;
  propertiesFor: (assetId: string) => Record<string, ScriptPropertyDef>;
  displayName: (assetId: string) => string | null;
}

/**
 * The surface a compiled script bundle is allowed to reach.
 *
 * Published on a global rather than imported, because the bundle must not pull
 * its own copy of the runtime — that would mean a second three.js in memory and
 * `instanceof` failing across the boundary. The build aliases `@three-studio/runtime`
 * to a shim that reads this.
 */
/** Kept alive so stack traces from the running bundle stay resolvable. */
let previousBundleUrl: string | null = null;

function publishScriptApi(): void {
  (globalThis as unknown as Record<string, unknown>)['__STUDIO_SCRIPT_API__'] = {
    version: SCRIPT_API_VERSION,
    Behaviour,
    registerScript,
  };
}

export const useScriptStore = create<ScriptState>()((set, get) => ({
  building: false,
  errors: [],
  warnings: [],
  revision: 0,

  build: async () => {
    set({ building: true, errors: [], warnings: [] });
    try {
      const result = await window.studio.scripts.build();
      if (result.errors.length > 0) {
        // Dropped even on failure. Leaving them registered meant a typo in a
        // script silently ran the *previous* version, which looks like the edit
        // simply had no effect.
        clearScripts();
        set({ errors: result.errors, warnings: result.warnings, revision: get().revision + 1 });
        for (const error of result.errors) console.error(`[script build] ${error}`);
        return false;
      }

      // Nothing changed on disk, so the classes already registered are the ones
      // that match the source. Re-importing would discard live state for no
      // reason and put an esbuild run in front of every Play.
      // `previousBundleUrl` is the honest test for "this session has already
      // imported a bundle" — the main process caches across project switches,
      // so `unchanged` alone would skip the very first import after a reload.
      if (result.unchanged && previousBundleUrl !== null) {
        set({ warnings: result.warnings });
        return true;
      }

      publishScriptApi();
      // Previous classes are dropped first so a deleted script stops resolving.
      clearScripts();

      // A blob URL rather than a data URL: sourcemaps resolve, and the CSP
      // already allows `blob:` in script-src for exactly this.
      const blob = new Blob([result.code], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);
      // The previous bundle's URL is released only now. Revoking immediately
      // after the import made devtools unable to fetch the source behind a
      // script's stack trace, which is the moment it is most wanted.
      if (previousBundleUrl) URL.revokeObjectURL(previousBundleUrl);
      previousBundleUrl = url;
      await import(/* @vite-ignore */ url);

      for (const warning of result.warnings) console.warn(`[script build] ${warning}`);
      set({ warnings: result.warnings, revision: get().revision + 1 });
      return true;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error(`[script build] ${message}`);
      set({ errors: [message] });
      return false;
    } finally {
      set({ building: false });
    }
  },

  propertiesFor: (assetId) => scriptClassFor(assetId)?.properties ?? {},
  displayName: (assetId) => scriptClassFor(assetId)?.name ?? null,
}));
