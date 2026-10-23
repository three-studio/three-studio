import {
  BUILD_FORMAT_VERSION,
  BUILD_LAYOUT,
  type AssetSettings,
  type BuildManifest,
  type TextureEncoding,
  SCRIPT_API_VERSION,
  deserializeScene,
  encodePath,
  type SceneDoc,
} from '@three-studio/core';
import { SceneHost } from '@three-studio/runtime/SceneHost';
import { announce } from './announce';
import { unlockAudioOnGesture } from './audioGesture';
import { blockPageZoom } from './pageZoom';
import { entrySceneName, sceneOf } from './scenes';
import { createRenderer } from '@three-studio/runtime/RendererFactory';
import { studioTime } from '@three-studio/runtime/time/StudioTime';
import type { AssetResolver } from '@three-studio/runtime/assets/AssetResolver';
import { Behaviour } from '@three-studio/runtime/scripting/ScriptApi';
import { OrthographicCamera, PerspectiveCamera } from 'three/webgpu';
import { registerScript } from '@three-studio/runtime/scripting/ScriptHost';

/**
 * The player an exported build ships.
 *
 * It is deliberately thin: the engine owns the scene graph, physics and
 * behaviours, and neither the renderer nor the loop, so what runs here is the
 * same code the editor runs in play mode. Anything this file had to reimplement
 * would be a place the two could drift apart.
 *
 * It reads what the exporter writes in `game/` beside it:
 *   build.json   the manifest: what the profile chose, the scenes, the asset
 *                table, materials and prefabs — see `BuildManifest`
 *   scenes/…     every scene, the entry point first in `build.scenes`
 *   assets/…     what the scenes use
 *   scripts/…    the compiled behaviours, when the project has any
 *
 * Every path but the manifest's own is read **off the manifest**, relative to
 * it, so there is one way to find a file and nothing is worked out twice.
 */

/** Where the manifest is, from the page — and, through it, every other file of the game. */
const MANIFEST_URL = new URL(BUILD_LAYOUT.manifest, document.baseURI);

/**
 * A path the manifest holds, as the URL to fetch.
 *
 * Against the manifest rather than the page: the exporter and the device
 * server both write paths relative to it, and the page may carry a `<base>`.
 * Encoded segment by segment — see `encodePath` — since an asset may be named
 * `brick wall #2.png`.
 */
function resolve(path: string): string {
  return new URL(encodePath(path), MANIFEST_URL).href;
}

// Before anything loads: the loading screen and the Play screen are pinched
// too, and a page zoomed there opens the game zoomed.
blockPageZoom(document);

const canvas = document.querySelector<HTMLCanvasElement>('#view');
const overlay = document.querySelector<HTMLElement>('#overlay');
const message = document.querySelector<HTMLElement>('#message');
const startButton = document.querySelector<HTMLButtonElement>('#start');

/** Published for the compiled script bundle; see `ScriptHost`. */
function publishScriptApi(): void {
  (globalThis as unknown as Record<string, unknown>)['__STUDIO_SCRIPT_API__'] = {
    version: SCRIPT_API_VERSION,
    Behaviour,
    registerScript,
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
  return (await response.json()) as T;
}

function buildResolver(
  paths: Record<string, string>,
  encodings: Record<string, TextureEncoding> = {},
  settings: Record<string, AssetSettings> = {},
): AssetResolver {
  return {
    // Off the manifest, so the build runs from a subdirectory as happily as
    // from a root — and from wherever the `<base>` an export can carry points.
    url: (assetId) => {
      const path = paths[assetId];
      return path === undefined ? null : resolve(path);
    },
    // `null` means "the extension knows", which is true of everything the
    // exporter did not have to write down.
    encoding: (assetId) => encodings[assetId] ?? null,
    // `null` means "use the format's defaults", which is what a build from
    // before this field was written already relied on.
    settings: (assetId) => settings[assetId] ?? null,
  };
}

/**
 * One scene, by whichever half of its identity was named.
 *
 * Looked up, never formed: the manifest says where each scene is, and the
 * exporter names them by their content, so a path worked out from an id would
 * be a guess.
 */
async function readScene(build: BuildManifest, named: string): Promise<SceneDoc> {
  const { path } = sceneOf(build, named);
  const response = await fetch(resolve(path));
  // Named, so a missing scene reads as a missing scene. Without it a static
  // server's 404 page is handed to the parser, which reports a syntax error.
  if (!response.ok) throw new Error(`${path}: ${response.status} ${response.statusText}`);
  return deserializeScene(await response.text());
}

async function loadScripts(file: string | null): Promise<void> {
  publishScriptApi();
  if (!file) return; // The build manifest says this project has no scripts.

  try {
    // Off the manifest, not `import.meta.url`: this module lives in `player/`,
    // and resolving from it asked for `player/scripts.mjs`.
    await import(/* @vite-ignore */ resolve(file));
  } catch (cause) {
    // A scene without its behaviours is worth more than a black page: the
    // geometry, lights and camera are all still there to look at.
    console.error('[studio] scripts failed to load; running without them:', cause);
  }
}

async function boot(): Promise<void> {
  if (!canvas || !overlay || !message || !startButton) throw new Error('template markup missing');

  const build = await fetchJson<BuildManifest>(MANIFEST_URL.href);
  // Checked before the data is touched, and for equality: an export always
  // ships the player it came with, so another format means a folder holding two
  // versions — a player copied over an old build, or a half-copied upload.
  // Saying so beats failing on a field that is not there.
  if (build.formatVersion !== BUILD_FORMAT_VERSION) {
    throw new Error(
      `This folder holds format ${String(build.formatVersion)} data beside a player that reads format ${BUILD_FORMAT_VERSION}. Export the game again.`,
    );
  }

  /*
   * The entry scene can only be asked for once the manifest has arrived, since
   * the manifest is what names it. It used to be `scene.json` and could go out
   * in the same breath as `build.json`; that fixed name is exactly the
   * asymmetry format 5 removed, and one round trip is what it cost.
   */
  const entry = build.scenes[0];
  if (entry === undefined) throw new Error('This build lists no scene to start on.');
  const scene = await readScene(build, entry.id);

  await loadScripts(build.scripts);

  const { rendering, physics, materials, prefabs } = build;

  const { renderer, backend } = await createRenderer({
    canvas,
    forceWebGL: rendering.forceWebGL,
    antialias: rendering.antialias,
    maxPixelRatio: rendering.maxPixelRatio,
    shadows: rendering.shadows,
    exposure: rendering.exposure,
  });

  // Built before the host so the engine can mix into it. A browser will not
  // start it here — that takes a user gesture: the Play button below, or the
  // first touch on a page that started without it.
  const audioContext = typeof AudioContext === 'undefined' ? undefined : new AudioContext();

  // Hosted rather than a single engine: a game is a sequence of scenes, and a
  // script that moves to the next one has to reach something that can.
  const host = new SceneHost({
    source: {
      // By id, or by the name a script held: `sceneOf` finds either, and the
      // manifest says where the file is.
      read: (named: string) => readScene(build, named),
    },
    resolver: buildResolver(build.assets, build.textureEncodings, build.assetSettings),
    materials,
    prefabs,
    loadingScene: build.loadingScene,
    rendering,
    physicsSettings: physics,
    renderer,
    domElement: canvas,
    audioContext,
  });

  // Expanded exactly as the editor expands it, so a build shows what play mode
  // showed.
  await host.adopt(entrySceneName(build), scene);

  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    const camera = host.engine?.activeCamera;
    if (!camera) return;
    const aspect = window.innerWidth / window.innerHeight;
    if (camera instanceof PerspectiveCamera) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    } else if (camera instanceof OrthographicCamera) {
      // The document stores a vertical extent; width follows the window.
      const height = (camera.top - camera.bottom) / 2;
      camera.left = -height * aspect;
      camera.right = height * aspect;
      camera.updateProjectionMatrix();
    }
  };
  window.addEventListener('resize', resize);
  resize();

  document.title = build.title || scene.name;

  // The player owns the loop, so it owns the clock: this is what makes three's
  // `time` node — and therefore every node material in the build — read the
  // same seconds the scripts and the physics do. See `time/StudioTime`.
  studioTime.install();

  let last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    // Clamped: a backgrounded tab resumes with a delta of several seconds,
    // which would teleport every body through the floor on the first step.
    const delta = Math.min((now - last) / 1000, 0.1);
    last = now;

    studioTime.advance(delta);
    host.update(studioTime.delta);
    const engine = host.engine;
    if (engine) void renderer.render(engine.scene, engine.activeCamera);
  });

  message.textContent = build.title || scene.name;
  let started = false;
  // What the Play button does, once: a page the editor restarted calls it
  // without the button, and a click that lands after it must not do it twice.
  const start = (): void => {
    if (started) return;
    started = true;
    overlay.hidden = true;
    canvas.focus();
    // The gesture the whole page exists to collect, as far as audio is
    // concerned: a context created without one stays suspended, and a build
    // that is silent for that reason says nothing about it anywhere.
    void host.engine?.audio?.unlock();
  };
  startButton.hidden = false;
  startButton.addEventListener('click', start);
  // Any gesture, not only the Play button: a page started without it — a
  // phone the editor restarted — would otherwise stay silent for good. In an
  // export the Play tap is the first gesture, and starts the sound as before.
  if (audioContext !== undefined) {
    unlockAudioOnGesture(
      window,
      () => void host.engine?.audio?.unlock(),
      () => audioContext.state === 'running',
    );
  }

  // A game nobody is looking at is a game nobody should be hearing. The root
  // gain and not `context.suspend()`, so the timeline keeps running and a
  // returning player does not find every loop restarted.
  document.addEventListener('visibilitychange', () => {
    host.engine?.audio?.setSuspended(document.hidden);
  });

  // Surfaced rather than swallowed: a build with no camera or no collider is
  // the single most likely thing to look broken for no visible reason.
  const report = (warnings: readonly string[]) => {
    if (warnings.length > 0) console.warn('[studio]', warnings.join('\n'));
  };
  // Re-attached on every scene: each one builds its own engine, and warnings
  // from the second level are as worth hearing as the first's.
  const watch = () => {
    const engine = host.engine;
    if (!engine) return;
    engine.onWarning = report;
    report(engine.warnings);
  };
  host.onSceneChanged = () => {
    watch();
    resize();
  };
  watch();

  // Last, once the page is whole: whoever hears this may start the game at
  // once. See `announce.ts` for who does.
  announce({ state: 'running', backend, renderer, host, start });
}

boot().catch((cause: unknown) => {
  const text = cause instanceof Error ? cause.message : String(cause);
  if (message) message.textContent = `Could not start: ${text}`;
  console.error('[studio] boot failed:', cause);
  announce({ state: 'failed', error: text });
});
