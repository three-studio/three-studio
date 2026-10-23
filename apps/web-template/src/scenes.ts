import type { BuildManifest, BuildScene } from '@three-studio/core';

/*
 * The scenes a build ships, found by whichever half of their identity a script
 * holds.
 *
 * The manifest lists every scene with its id, its name and its path. The id is
 * the address and the path is where the file is; the name is an alias, the one
 * an author reads, which a script may hold instead of the id. Nothing is found
 * by a path a script made up.
 */

/**
 * The scene a script named, by id first and then by name.
 *
 * Ids first: a scene named exactly like another's id is not a case to
 * arbitrate — the id is the address, so it wins. Then the **first** scene
 * under a name: the entry is listed first, so when a scene in another folder
 * shares its name the entry still answers to it, as `scenes.current` does in
 * Play.
 *
 * @throws when the build has no such scene, which is the only useful answer —
 *   fetching a guessed path would report a missing file instead of a missing
 *   scene.
 */
export function sceneOf(build: Pick<BuildManifest, 'scenes'>, named: string): BuildScene {
  const scene =
    build.scenes.find((candidate) => candidate.id === named) ??
    build.scenes.find((candidate) => candidate.name === named);
  if (scene === undefined) throw new Error(`This build has no scene named "${named}".`);
  return scene;
}

/**
 * What the entry scene is called, as a script asking `scenes.current` sees it.
 *
 * The editor runs the scene being edited under its **name**, so a build has to
 * answer with the name too or `scenes.current` reads one thing in play mode and
 * another in the thing people download. That was a real bug with the worst
 * shape a bug can have: it worked while the script was being written and broke
 * the moment it shipped.
 */
export function entrySceneName(build: Pick<BuildManifest, 'scenes'>): string {
  return build.scenes[0]?.name ?? '';
}
