/**
 * On-disk project layout:
 *
 * ```
 * MyProject/
 *   project.json            this file
 *   scenes/main.scene.json  SceneDoc documents
 *   assets/                 models, textures, materials, scripts
 *     manifest.json
 *   .studio/                caches and build output — safe to delete
 * ```
 */
import type { Vec3 } from '../scene/schema';

/**
 * One scene of a project.
 *
 * The **id** is what everything else refers to — the start scene, the loading
 * scene, a build profile, the window's URL. It is the scene document's own
 * `SceneDoc.id`, so a scene carries its identity inside itself and a file that
 * is moved or restored from a backup is still recognisably the same scene.
 *
 * The **name** is for the person using the editor. It is required, and it is
 * indicative: nothing resolves through it internally, so renaming a scene is a
 * one-line change to this file and breaks nothing.
 *
 * The **path** is where the file happens to be. It is not an identity either:
 * it is fixed when the scene is created and never rewritten, precisely so that
 * a rename cannot move it.
 */
export interface SceneEntry {
  id: string;
  name: string;
  /** Relative to the project root. */
  path: string;
}

export interface ProjectFile {
  version: number;
  name: string;
  /** Editor version that last wrote the project, for diagnostics. */
  engineVersion: string;
  scenes: SceneEntry[];
  /** Scene **id** the project opens on, and a build starts with. */
  startScene: string;
  settings: ProjectSettings;
}

/** The entry for a scene id, or `undefined` for one the project has dropped. */
export function findScene(project: ProjectFile, id: string): SceneEntry | undefined {
  return project.scenes.find((entry) => entry.id === id);
}

/**
 * Resolves what a script named, which may be an id or a name.
 *
 * Ids first: a script that wants to survive a rename can hold one, and a name
 * that happened to look like an id must not shadow the real thing. Names are
 * unique within a project, so the second lookup is unambiguous.
 */
export function resolveScene(project: ProjectFile, idOrName: string): SceneEntry | undefined {
  return (
    findScene(project, idOrName) ?? project.scenes.find((entry) => entry.name === idOrName)
  );
}

/**
 * How the project behaves, as against what is in it.
 *
 * Unity and Unreal both keep this in the project and in version control, and
 * both make packaging one section of it rather than a thing of its own. Every
 * field here is read by something: a setting that does nothing is worse than a
 * setting that is missing, because it is a promise. `forceWebGL` sat here
 * unread from the day it was added.
 */
/**
 * A scene's name, as scripts refer to it: `scenes/Level2.scene.json` is
 * `Level2`.
 *
 * Names rather than paths, because the two are not the same in a build — the
 * exporter renames the entry scene to `scene.json` and files the rest under
 * `scenes/`. A script saying `load('Level2')` has to mean the same thing in the
 * editor and in an exported game, and a path cannot. Unity addresses scenes the
 * same way, and for the same reason.
 */
export function sceneName(path: string): string {
  const file = path.split('/').at(-1) ?? path;
  return file.replace(/\.scene\.json$/i, '').replace(/\.json$/i, '');
}

export interface ProjectSettings {
  /**
   * Scene **id** shown while another loads. `null` swaps straight over.
   *
   * A scene rather than a built-in overlay, because everything else here is
   * one: the bar, the logo and the Press Start are authored in the editor with
   * the same tools as a level. It loads first and the target loads behind it —
   * the classic Unity arrangement, which needs no additive loading at all.
   */
  loadingScene: string | null;
  rendering: RenderingSettings;
  physics: PhysicsSettings;
  /** Named build configurations, keyed by id; see `BuildProfile`. */
  build: BuildProfiles;
}

export interface RenderingSettings {
  /**
   * Forces the WebGL2 backend. `WebGPURenderer` falls back on its own when
   * WebGPU is missing; forcing it is how you find out whether a rendering bug
   * belongs to the backend or to us.
   */
  forceWebGL: boolean;
  antialias: boolean;
  /** Cap on `devicePixelRatio`. The cheapest knob there is on a retina display. */
  maxPixelRatio: number;
  shadows: boolean;
  /** Per light. Square, powers of two; 4096 is four times the memory of 2048. */
  shadowMapSize: number;
  /** `toneMappingExposure`. */
  exposure: number;
}

export interface PhysicsSettings {
  gravity: Vec3;
  /**
   * Seconds per physics step. Smaller is more stable and more expensive, and
   * it is not the frame rate — the solver runs at this rate whatever the
   * display does.
   */
  fixedTimestep: number;
  /**
   * Ceiling on steps per frame. Without one, a frame that took a second asks
   * for sixty steps, which takes longer than a second, and the simulation
   * never catches up.
   */
  maxSubsteps: number;
}

export function createRenderingSettings(): RenderingSettings {
  return {
    forceWebGL: false,
    antialias: true,
    maxPixelRatio: 2,
    shadows: true,
    shadowMapSize: 2048,
    exposure: 1,
  };
}

export function createPhysicsSettings(): PhysicsSettings {
  return { gravity: [0, -9.81, 0], fixedTimestep: 1 / 60, maxSubsteps: 5 };
}

/**
 * What an exported build can be produced for.
 *
 * One today. It is an enum rather than a boolean because both engines make the
 * target the axis everything else hangs off, and retrofitting that is painful:
 * Unity switches an active platform and re-imports assets for it, Unreal cooks
 * per target platform. `desktop` — the same player wrapped in Electron — is the
 * next plausible one, which is why this is not called `web`.
 */
export type BuildTargetId = 'web';

/**
 * A named, saved set of build options — Unity's Build Profiles rather than a
 * dialog filled in from scratch each time. Kept in the project so that what a
 * build contains is reviewable in a diff and identical on another machine.
 */
export interface BuildProfile {
  name: string;
  target: BuildTargetId;
  /**
   * Scene **ids** to ship. The first is the entry point, as in Unity's Scenes
   * In Build. Empty means "the start scene only".
   */
  scenes: string[];
  /** Last folder exported to, so the next export can offer it again. */
  outputDir: string | null;
  /**
   * Ship every asset in the project rather than only what the scenes reach.
   * Unreal's "cook everything"; useful when scripts load assets by name.
   */
  includeAllAssets: boolean;
  /** Window title and document title of the produced page. */
  title: string;
  /**
   * Where the build will be served from, or `''` for "relative to the page".
   *
   * Written into a `<base href>` on the exported page, so it governs everything
   * at once: the player bundle, the favicon, the JSON documents beside them,
   * every asset and the compiled script bundle are all resolved against the
   * document, and one tag moves all of them together.
   *
   * Empty is the default and leaves the page exactly as the template ships it,
   * which is right anywhere the address ends in a slash. A value is what fixes
   * the case it does not: served at `/games/demo` with no redirect to
   * `/games/demo/`, every relative URL resolves one level too high.
   */
  basePath: string;
}

export interface BuildProfiles {
  /** Profile id the export command uses when none is named. */
  active: string;
  profiles: Record<string, BuildProfile>;
}

export const DEFAULT_BUILD_PROFILE_ID = 'web';

export function createBuildProfiles(projectName: string): BuildProfiles {
  return {
    active: DEFAULT_BUILD_PROFILE_ID,
    profiles: {
      [DEFAULT_BUILD_PROFILE_ID]: {
        name: 'Web',
        target: 'web',
        scenes: [],
        outputDir: null,
        includeAllAssets: false,
        title: projectName,
        basePath: '',
      },
    },
  };
}

/**
 * Fills profiles read off disk with the fields that did not exist when they
 * were written.
 *
 * The same shape as the settings sections above: through the type's own
 * factory, so adding a build option stays a change to `createBuildProfiles`
 * rather than a migration. A profile from before `basePath` gets `''`, which is
 * exactly the behaviour it was exported against.
 */
export function normalizeBuildProfiles(
  build: BuildProfiles | undefined,
  projectName: string,
): BuildProfiles {
  const fresh = createBuildProfiles(projectName);
  if (!build) return fresh;
  const defaults = fresh.profiles[DEFAULT_BUILD_PROFILE_ID]!;
  return {
    active: build.active,
    profiles: Object.fromEntries(
      Object.entries(build.profiles).map(([id, profile]) => [id, { ...defaults, ...profile }]),
    ),
  };
}

/**
 * What `<base href>` will carry, or `''` when the page should get no tag.
 *
 * The trailing slash is not cosmetic: `/games/demo` resolves `assets/x.png` to
 * `/games/assets/x.png`, one level too high. It is added rather than demanded
 * of the author — Vite's own `base` enforces the same rule for the same reason.
 *
 * `.`, `./` and `''` all say "relative to the document", which is what the page
 * already does with no tag at all. They collapse to `''` so the output stays
 * byte for byte what it was before this field existed, and so the dialog can
 * show the author that the three are one thing.
 */
export function normalizeBasePath(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '.' || trimmed === './') return '';
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

/**
 * Why this base cannot be written, or `null` when it can.
 *
 * `?` and `#` are refused because normalizing would run straight through them:
 * `http://host/app?v=1` would become `http://host/app?v=1/`, a request for a
 * path that does not exist. Quotes, angle brackets and whitespace are refused
 * because the value ends up inside an HTML attribute — escaped, they would
 * produce a quietly broken URL instead of a message the author can read.
 */
export function basePathProblem(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (trimmed.includes('?') || trimmed.includes('#')) {
    return 'A base URL cannot carry a query or a fragment; it is a folder, not a request.';
  }
  if (/["'<>`\s]/.test(trimmed)) {
    return 'A base URL cannot contain spaces, quotes or angle brackets.';
  }
  return null;
}

/** What the launcher lists. Kept small so the recents file stays cheap to read. */
export interface ProjectSummary {
  name: string;
  /** Absolute path to the project directory; also its identity. */
  path: string;
  lastOpenedAt: number;
}

/** Everything the editor needs to show a project, in one round trip. */
export interface OpenProject {
  summary: ProjectSummary;
  project: ProjectFile;
  /** Path of the loaded scene, relative to the project root. */
  scenePath: string;
  /** Id of the loaded scene — what the window and every reference use. */
  sceneId: string;
  /** Serialized `SceneDoc`; the renderer parses it so `core` owns the format. */
  sceneJson: string;
}

export const PROJECT_FILE_NAME = 'project.json';
export const SCENES_DIR = 'scenes';
export const ASSETS_DIR = 'assets';
export const CACHE_DIR = '.studio';
