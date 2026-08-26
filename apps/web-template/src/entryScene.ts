import { sceneName } from '@three-studio/core';

/** The part of `build.json` that says which scene the player starts on. */
export interface EntrySceneManifest {
  /** Entry point first; the rest ship for a script to load later. */
  scenes: string[];
  /** Scene name → file in this build; written by the exporter. */
  sceneMap?: Record<string, string>;
}

/**
 * What the entry scene is called, as a script asking `scenes.current` sees it.
 *
 * Not `sceneName(scenes[0])`, which is what this used to be: the exporter
 * renames the entry scene to `scene.json`, so that read `scene` in a build and
 * `main` in the editor. A script testing `scenes.current === 'main'` therefore
 * worked while it was being written and broke the moment it shipped — the worst
 * shape a bug can have.
 *
 * `sceneMap` is the exporter's own record of which name became which file, so
 * it is what answers the question. The fallback is for a build written before
 * `sceneMap` existed, where the old behaviour is all there is to fall back to.
 */
export function entrySceneName(build: EntrySceneManifest): string {
  const file = build.scenes[0] ?? 'scene.json';
  const named = Object.entries(build.sceneMap ?? {}).find(([, path]) => path === file);
  return named?.[0] ?? sceneName(file);
}
