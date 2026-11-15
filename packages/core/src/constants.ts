export const ENGINE_NAME = 'Three Studio';

/**
 * What this build of the source tree calls itself.
 *
 * The one version in this file that is not a format number, and the one with
 * the longest reach. Three things read it:
 *
 *  - **the launcher and the status bar** — the only version a user ever sees.
 *    Nothing in this codebase calls `app.getVersion()`, so there is no second
 *    number competing with it on screen;
 *  - **`project.engineVersion`**, stamped on every project this build opens and
 *    shown in Project Settings. A record of what wrote the file; nothing
 *    compares it, so moving it can break nothing;
 *  - **the key of both derived indexes** — `scenes.index.json` and the asset
 *    scan, whose key is `${ENGINE_VERSION}:meta${ASSET_META_VERSION}`. Moving
 *    this throws both away, so the next open of every project is slower, once.
 *    That is the only cost of a bump, and it is the reason not to do it idly.
 *
 * **A release cannot reach this, and that is the arrangement rather than a gap
 * to close.** `release.yml` stamps the tag into `apps/desktop/package.json` on
 * the runner, the only file electron-builder reads: that governs the
 * *installer* — its filename, and the version the packaged app declares to the
 * operating system. This governs what the *source tree* says it is. The two
 * agree whenever a tag is cut to match a bump, which is the ordinary flow, and
 * they are free to differ for a nightly or a tag that is not a version number
 * at all (`v2026-summer`).
 *
 * So: bump it when the product moves, in a commit that says so — never as part
 * of cutting a release, which already does its own job on the file that needs
 * it.
 */
export const ENGINE_VERSION = '0.6.0';

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
 *
 * 3 — `Behaviour` gained `this.body` and `this.physics`: forces, impulses,
 * torques, velocities and teleports on the body an entity moves with, any
 * entity's body by id, gravity, and character controllers of a script's own. A
 * bundle compiled against 2 never named them — but `body` and `physics` joined
 * the reserved property names, so a script that declared a property called
 * `body` now has it refused with a warning instead of silently replacing the
 * api. And four hooks, `onCollisionEnter`, `onCollisionExit`, `onTriggerEnter`
 * and `onTriggerExit`, which hear what the entity's colliders touch: their
 * names joined the reserved ones too, so a property called `onTriggerEnter` is
 * now refused with a warning. `this.physics` also gained rays, sphere, box and
 * capsule casts, sphere and box overlaps, and the project's collision layers: a
 * bundle compiled against them calls members an older build does not have. So
 * did `joint(id)`, which reads a joint and drives its motor.
 *
 * 4 — the API lost `registerScript`. A bundle no longer files its classes in a
 * table of the page's: it exports them as `scripts`, pairs of an asset id and a
 * class, and the host decodes them and hands them to the engine that runs them.
 * A bundle compiled against 3 calls a `registerScript` that is gone, which this
 * check turns into a sentence rather than a `TypeError`.
 */
export const SCRIPT_API_VERSION = 4;

/**
 * Scene document format version.
 *
 * **Until 1.0.0, a format that changes takes the next number, a file of any
 * other number is refused — older or newer, in one diagnostic naming both —
 * and nothing converts it.** Converting was a ladder of passes, each written
 * once and run on every load after, each a place where an old file could be
 * read as something its author never wrote; and a file a newer build wrote
 * holds fields whose meaning this build cannot know. From 1.0.0 the additive
 * rule returns: fields are added, never removed, and filled from their type.
 *
 * **A number takes more changes only while no release carries it.** A change
 * may join the current number instead of taking the next one only while no
 * build outside this tree reads it: once a release carries it, such a build
 * exists, and only the next number makes it refuse the file rather than open it
 * and be quietly wrong. Ask the latest release tag whether the current number
 * has shipped (`git show <tag>:packages/core/src/constants.ts`). The same holds
 * for every format number in this file.
 *
 * 12 — the first format read with nothing converted: a scene of 11 or earlier
 * is refused, where it used to be filled and converted on every load. What the
 * earlier numbers changed is in git's history, with the code that converted
 * them.
 *
 * And the types described by their fields are decoded whole: a field of the
 * wrong kind, one missing inside an object — a light's shadow — or one no
 * field of the type refuses the scene, where it was filled or dropped. A rigid
 * body's locks are named axes, `{ x, y, z }`, where they were a tuple. A water
 * surface's sun is one field, `sun` — the sky, a light by its id, or a sun of
 * its own — where three said it, the light by an id among two keywords. The
 * four asset slots that said "none" with `''` — a model's file, an audio
 * source's clip, a script's script, a prefab instance's prefab — say it with
 * `null`, as every other slot does.
 *
 * And the rest of the file is decoded whole as well — each entity, the
 * environment, the shell — so that nothing in it is filled any more. Beside
 * `components`, `componentVersions` records the version of each type the file
 * holds a component of: a type this build defines at another version refuses
 * the file, and a table with no version, or a version with no table, refuses
 * it too. Only the tables that hold a component are written, where every type
 * of the build that wrote it had one.
 */
export const SCENE_FORMAT_VERSION = 12;

/**
 * Separates an instance from the entity it produced, in an expanded id.
 *
 * Read by `prefab.ts`, which builds those ids, and by the graph and the editor,
 * which take them apart. Never present in a stored id.
 */
export const PREFAB_ID_SEPARATOR = '/';

/**
 * `assets/prefabs/*.prefab.json`. A prefab holds the same component tables as
 * a scene, so it moves with the scene's format, and is refused at any other
 * number and never converted, as a scene is (see `SCENE_FORMAT_VERSION`).
 *
 * 9 — the format of scene 12, its versions of the types included; and the
 * file holds no id of its own. A prefab is an asset, filed under its sidecar's
 * id, and a second copy in the file is what a hand edit or a copied file makes
 * disagree with the first.
 */
export const PREFAB_FORMAT_VERSION = 9;

/**
 * Project file format version, apart from the scenes' and prefabs' and moved
 * with them: it changes with **any** change in any file of a project,
 * `project.json` or not.
 *
 * That is what refuses an older project whole, once, when it is opened —
 * before any scene of it is read — rather than letting it open and refuse its
 * scenes one by one as they are reached, or a prefab in the middle of Play. A
 * file of another number is refused in one diagnostic naming both, and nothing
 * converts it (see `SCENE_FORMAT_VERSION`).
 *
 * 4 — scenes 12 and prefabs 9; and `project.json` itself is decoded, every
 * field of the kind it is declared and no other.
 */
export const PROJECT_FORMAT_VERSION = 4;
