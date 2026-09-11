import type { BuildManifest } from '@three-studio/core';

/*
 * The manifest's alias table, read in both directions.
 *
 * A build addresses every scene by id — `buildScenePath` is where the file is —
 * and `sceneNames` maps the names an author gave them onto those ids. That is
 * an alias and not a second address: nothing here *finds* a scene by name, it
 * turns a name into the id that finds it.
 */

/**
 * The id a script named, whichever half of the scene's identity it held.
 *
 * Ids first, then names. A scene named exactly like another's id is not a case
 * to arbitrate: the id is the address, so it wins.
 *
 * @throws when the build has no such scene, which is the only useful answer —
 *   fetching `scenes/undefined.json` would report a missing file instead of a
 *   missing scene.
 */
export function sceneIdOf(build: Pick<BuildManifest, 'scenes' | 'sceneNames'>, named: string): string {
  if (build.scenes.includes(named)) return named;
  const id = build.sceneNames?.[named];
  if (id === undefined) throw new Error(`This build has no scene named "${named}".`);
  return id;
}

/**
 * What the entry scene is called, as a script asking `scenes.current` sees it.
 *
 * The editor runs the scene being edited under its **name**, so a build has to
 * answer with the name too or `scenes.current` reads one thing in play mode and
 * another in the thing people download. That was a real bug with the worst
 * shape a bug can have: it worked while the script was being written and broke
 * the moment it shipped. It used to be the file name — `scene`, because the
 * entry scene was renamed to `scene.json` — where the editor said `main`.
 *
 * The scan is the reverse of the table's own direction, and it runs once at
 * boot; loading a scene goes the cheap way, through `sceneIdOf`.
 *
 * Falls back to the id. A build written before `sceneNames` cannot be read at
 * all — its scenes are elsewhere — so this is for a scene the table forgot,
 * where an id is at least true.
 */
export function entrySceneName(build: Pick<BuildManifest, 'scenes' | 'sceneNames'>): string {
  const id = build.scenes[0];
  if (id === undefined) return '';
  const named = Object.entries(build.sceneNames ?? {}).find(([, sceneId]) => sceneId === id);
  return named?.[0] ?? id;
}
