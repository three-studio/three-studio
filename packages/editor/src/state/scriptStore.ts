import { isAssetId } from '@three-studio/core';
import {
  NO_SCRIPTS,
  publishScriptApi,
  scriptClassesOf,
  type ScriptClasses,
  type ScriptPropertyDef,
} from '@three-studio/runtime';
import { create } from 'zustand';

interface ScriptState {
  building: boolean;
  errors: string[];
  warnings: string[];
  /** Bumped after each successful build so the inspector re-reads properties. */
  revision: number;
  /**
   * The classes of the bundle imported now, which Play hands to the game it
   * runs. None before the first import, and once a failed build has dropped
   * them.
   */
  scripts: ScriptClasses;

  build: () => Promise<boolean>;
  propertiesFor: (assetId: string) => Record<string, ScriptPropertyDef>;
  displayName: (assetId: string) => string | null;
}

/** Kept alive so stack traces from the running bundle stay resolvable. */
let previousBundleUrl: string | null = null;

/**
 * The bundle whose classes are held now — `null` before the first import and
 * once a failed build has dropped them. A build handing back this same code
 * needs no import.
 */
let importedCode: string | null = null;

export const useScriptStore = create<ScriptState>()((set, get) => ({
  building: false,
  errors: [],
  warnings: [],
  revision: 0,
  scripts: NO_SCRIPTS,

  build: async () => {
    set({ building: true, errors: [], warnings: [] });
    try {
      const result = await window.studio.scripts.build();
      if (result.errors.length > 0) {
        // Dropped even on failure. Leaving them in place meant a typo in a
        // script silently ran the *previous* version, which looks like the edit
        // simply had no effect.
        importedCode = null;
        set({
          scripts: NO_SCRIPTS,
          errors: result.errors,
          warnings: result.warnings,
          revision: get().revision + 1,
        });
        for (const error of result.errors) console.error(`[script build] ${error}`);
        return false;
      }

      // The main process compiles on every call, so code equal to what was
      // imported means the sources did not change, and the classes held
      // match them. Importing it again would discard live state for nothing,
      // and hold a second copy of the same bundle.
      if (result.code === importedCode) {
        set({ warnings: result.warnings });
        return true;
      }

      publishScriptApi();
      // Previous classes are dropped first so a deleted script stops resolving.
      set({ scripts: NO_SCRIPTS });
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
      // What the bundle exports, decoded: it is a build of the author's code.
      const scripts = scriptClassesOf(await import(/* @vite-ignore */ url));
      importedCode = result.code;

      for (const warning of result.warnings) console.warn(`[script build] ${warning}`);
      set({ scripts, warnings: result.warnings, revision: get().revision + 1 });
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

  propertiesFor: (assetId) => (isAssetId(assetId) ? get().scripts.get(assetId)?.properties : undefined) ?? {},
  displayName: (assetId) => (isAssetId(assetId) ? get().scripts.get(assetId)?.name : undefined) ?? null,
}));
