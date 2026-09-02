export const ENGINE_NAME = 'Three Studio';
export const ENGINE_VERSION = '0.2.0';

/**
 * The surface compiled user scripts are built against.
 *
 * A bundle carries the number it was compiled with and checks it when it
 * loads. Removing or renaming something on `__STUDIO_SCRIPT_API__` without
 * bumping this would break scripts compiled earlier, at the point they are
 * used and with no message worth reading.
 *
 * 2 — `Behaviour` gained `this.audio`: the entity's own sources, one-shot
 * clips, and the buses. Additive, so a script compiled against 1 runs
 * unchanged — but `audio` also joined the reserved property names, so a script
 * that happened to declare a property called `audio` now has it refused with a
 * warning instead of silently overwriting the api. That is what the number is
 * for: the change is invisible until it is not.
 */
export const SCRIPT_API_VERSION = 2;

/**
 * Scene document format version. Bump on any schema change; `migrateScene`
 * fills what is missing and rejects anything written by a newer build, rather
 * than silently loading a shape this code no longer understands.
 *
 * 9 — the `water` component. An older build has no system for it, so it opens
 * the scene, keeps the component byte for byte — `adoptComponentTables` files an
 * unknown type under its own table and never touches the body — and draws
 * nothing where the water is. A scene built around an ocean is then not a scene
 * that half-works, it is one that is silently missing its subject, which is the
 * same call 8 and 5 made.
 *
 * `water.speed`, `water.direction` and `water.choppiness` were added to that
 * same 9 rather than under a 10 of their own, because 9 was never released: it
 * exists in this working tree and nowhere else. `fillComponent` merges a water
 * component from its factory, so a scene already saved as 9 picks the three up
 * on opening — the same reasoning `sky.cloudSpeed` was folded into 6 with.
 *
 * 7 — a `model` says which node of its file it draws (`nodePath`, `nodeName`)
 * and which shared material it draws with (`materialId`). The first is what
 * `unpackModel` writes: one imported file becomes one entity per node, and a
 * build that ignores `nodePath` draws the **whole model** at every one of them.
 * That is not a lost field, it is a scene that looks like a hundred copies of
 * itself, so refusing the file is much the better failure.
 *
 * 8 — an audio source gained the seven playback fields the engine needs and it
 * never had: `mute`, `detune`, `startOffset`, `delay`, `fadeIn`, `fadeOut` and
 * `priority`. The fields themselves survive an older build untouched —
 * `fillComponent` spreads the stored component over the factory, so what it has
 * never heard of it copies through. The bump is not about losing them.
 *
 * It is about what an older build *does*. Every build before this one carries
 * `runtime: false` on `audioSource`: it opens the scene, shows the source, and
 * plays nothing at all. A level whose design depends on a sound is not a level
 * that half-works there, it is one that is silently not what it says — and
 * refusing the file is the better failure, as it was for 5.
 *
 * 6 — the environment gained the four knobs three has always had and we never
 * exposed — background blur, background intensity, a shared rotation — plus a
 * source for the image-based lighting and an analytic `sky` block. Two reasons
 * this is a bump rather than a quiet addition, and the second is the strong
 * one: an older build erases the new fields on its first save, and
 * `backgroundMode` gained a third value it would fall off the end of.
 *
 * `sky.cloudSpeed` was added to that same 6 rather than under a 7 of its own,
 * because 6 was never released: it exists in this working tree and in projects
 * written by builds of this same piece of work. `fillMissingFields` merges the
 * sky a level deeper from its factory, so a scene already saved as 6 picks the
 * field up on opening.
 *
 * 5 — two more light kinds, `rectArea` and `projector`, and the `shadow`
 * settings every casting kind now carries. An older build does not merely lose
 * the new fields, it falls off the end of an exhaustive `switch` on the light
 * kind and attaches `undefined` to the scene. Refusing the file is the better
 * failure.
 *
 * 4 — components live in `scene.components`, by type then by entity then by
 * their own id, instead of in an array on each entity. The array is read once
 * for its order — which is the only thing in it that is not derivable — and
 * removed. See ADR-16.
 *
 * 3 — every component carries an `id`, and prefab overrides name a component by
 * it rather than by its position. A document written before it gets ids derived
 * from where its components already are, so a scene and the prefabs it places
 * agree without either being able to read the other. See ADR-9 and B10.
 *
 * 2 — the environment gained a background mode and its texture, an IBL slot
 * and its intensity, and a fog mode with an exponential density.
 *
 * `fillMissingFields` already migrates them from the factory, so the bump is
 * not what makes an old scene open. It is what stops an *older* editor from
 * opening a new one: without it that build ignores the fields it has never
 * heard of and erases them on the first save.
 */
export const SCENE_FORMAT_VERSION = 9;

/**
 * Separates an instance from the entity it produced, in an expanded id.
 *
 * Here rather than beside the prefab code because both ends of the format need
 * it and they cannot import each other: `serialization.ts` reads it to migrate
 * override keys, and `prefab.ts` — which builds those ids — already imports
 * `serialization.ts`. Never present in a stored id.
 */
export const PREFAB_ID_SEPARATOR = '/';

/**
 * `assets/prefabs/*.prefab.json`.
 *
 * 6 — the water component of scene format 9. A prefab holds the same
 * `ComponentTables`, so it can hold a water surface an older build cannot draw.
 *
 * 5 — the model node and material of scene format 7. A prefab holds the same
 * `ComponentTables`, so it can hold a model split across a dozen entities —
 * which is exactly what `makePrefab` on an unpacked model produces.
 *
 * 4 — the light kinds and shadow settings of scene format 5. A prefab can hold
 * a light, so it can hold one an older build cannot build.
 *
 * 3 — components live in `prefab.components`, the same block a scene carries.
 * A prefab is a scene without an environment, and it is migrated by the same
 * function; the two format numbers move together for that reason.
 *
 * 2 — components carry an `id`, and prefab overrides name them by it rather
 * than by their position in the array. See ADR-9 and B10.
 */
export const PREFAB_FORMAT_VERSION = 6;

/**
 * Project file format version, tracked separately from scenes.
 *
 * 2 — scenes are referenced by id rather than by path. `scenes` holds
 * `{ id, name, path }` entries, and `startScene`, `loadingScene` and each
 * build profile name an id. See ADR-15: a reference that is a path or a name
 * is a reference that renaming breaks.
 */
export const PROJECT_FORMAT_VERSION = 2;
