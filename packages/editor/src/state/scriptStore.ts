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

/**
 * The bundle whose classes are registered now — `null` before the first import
 * and once a failed build has dropped them. A build handing back this same code
 * needs no import.
 */
let importedCode: string | null = null;

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
        importedCode = null;
        set({ errors: result.errors, warnings: result.warnings, revision: get().revision + 1 });
        for (const error of result.errors) console.error(`[script build] ${error}`);
        return false;
      }

      // The code already imported is the code on disk, so the classes
      // registered match the source. Re-importing would discard live state for
      // no reason.
      // The code itself is compared, not the build's `unchanged`: that flag is
      // measured against the main process's last build, which every window,
      // the export and each device launch share. Once a launch had compiled an
      // edited script, Play's own build answered `unchanged`, and Play ran the
      // classes from before the edit. After a reload, nothing has been
      // imported yet, whatever the main process has cached.
      if (result.code === importedCode) {
        set({ warnings: result.warnings });
        return true;
      }

      publishScriptApi();
      // Previous classes are dropped first so a deleted script stops resolving.
      clearScripts();
      importedCode = null;

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
      importedCode = result.code;

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
