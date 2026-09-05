import { sceneName, type BuildManifest } from '@three-studio/core';

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
 *
 * Takes the two fields it reads rather than the whole manifest, and takes them
 * by `Pick` rather than by an interface of its own: a partial copy of a shape
 * declared elsewhere is still a second declaration, and this one had already
 * drifted into being a third.
 */
export function entrySceneName(build: Pick<BuildManifest, 'scenes' | 'sceneMap'>): string {
  const file = build.scenes[0] ?? 'scene.json';
  const named = Object.entries(build.sceneMap ?? {}).find(([, path]) => path === file);
  return named?.[0] ?? sceneName(file);
}
