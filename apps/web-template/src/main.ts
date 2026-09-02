import {
  BUILD_FORMAT_VERSION,
  type AssetSettings,
  type TextureEncoding,
  SCRIPT_API_VERSION,
  deserializeScene,
  type MaterialDef,
  type PrefabDoc,
  type SceneDoc,
} from '@three-studio/core';
import { SceneHost } from '@three-studio/runtime/SceneHost';
import { entrySceneName, type EntrySceneManifest } from './entryScene';
import { encodePath } from './urls';
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
 * It reads three files the exporter writes beside it:
 *   build.json     what the build profile chose: title, backend, scene list
 *   scene.json     the entry scene
 *   assets.json    asset id -> path under assets/
 *   materials.json asset id -> material, for meshes that reference a shared one
 *   prefabs.json   asset id -> prefab, expanded before the engine sees the scene
 *   scripts.mjs    the compiled behaviours, absent when the project has none
 */

/** Written by the exporter from the build profile. */
interface BuildManifest extends EntrySceneManifest {
  /** Absent on a build written before builds were versioned. */
  formatVersion?: number;
  title: string;
  forceWebGL: boolean;
  /** Name of the scene shown while another loads, if the project has one. */
  loadingScene?: string | null;
  /** The compiled behaviour bundle, or null when the project has none. */
  scripts: string | null;
  /**
   * Images whose file name does not say how they store light.
   *
   * Ultra HDR and nothing else today: it is a `.jpg`, and without this the
   * player decodes it as an ordinary photograph — perfectly, and with every
   * stop above white gone. Absent on a build that had none, and on one written
   * before this field existed.
   */
  textureEncodings?: Record<string, TextureEncoding>;
  /**
   * What each asset was imported with.
   *
   * Absent on a build written before this field existed, and then every asset
   * falls back to its format's defaults — which is what those builds were
   * exported against anyway.
   */
  assetSettings?: Record<string, AssetSettings>;
}

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
    // Relative, so the build runs from a subdirectory as happily as from a
    // root — and from wherever the `<base>` an export can carry points.
    url: (assetId) => {
      const path = paths[assetId];
      return path === undefined ? null : `assets/${encodePath(path)}`;
    },
    // `null` means "the extension knows", which is true of everything the
    // exporter did not have to write down.
    encoding: (assetId) => encodings[assetId] ?? null,
    // `null` means "use the format's defaults", which is what a build from
    // before this field was written already relied on.
    settings: (assetId) => settings[assetId] ?? null,
  };
}

async function loadScripts(file: string | null): Promise<void> {
  publishScriptApi();
  if (!file) return; // The build manifest says this project has no scripts.

  try {
    // Against the document, not `import.meta.url`: the bundle lives in
    // `_studio/` while the exporter writes the script bundle beside
    // index.html, so resolving from the module asked for
    // `_studio/scripts.mjs`. Every other path here is document-relative too.
    await import(/* @vite-ignore */ new URL(file, document.baseURI).href);
  } catch (cause) {
    // A scene without its behaviours is worth more than a black page: the
    // geometry, lights and camera are all still there to look at.
    console.error('[studio] scripts failed to load; running without them:', cause);
  }
}

async function boot(): Promise<void> {
  if (!canvas || !overlay || !message || !startButton) throw new Error('template markup missing');

  const [build, sceneJson, assetPaths, materials, prefabs] = await Promise.all([
    fetchJson<BuildManifest>('build.json'),
    fetch('scene.json').then((response) => response.text()),
    fetchJson<Record<string, string>>('assets.json'),
    fetchJson<Record<string, MaterialDef>>('materials.json'),
    fetchJson<Record<string, PrefabDoc>>('prefabs.json'),
  ]);
  // Checked before the data is touched: a player reading a build it does not
  // understand should say so, not fail on a field it expected to be there.
  const version = build.formatVersion ?? 0;
  if (version > BUILD_FORMAT_VERSION) {
    throw new Error(
      `This build was produced by a newer version of the editor (format ${version}; this player reads up to ${BUILD_FORMAT_VERSION}). Re-export it, or use the player that came with it.`,
    );
  }

  const scene: SceneDoc = deserializeScene(sceneJson);

  await loadScripts(build.scripts ?? null);

  const { renderer } = await createRenderer({ canvas, forceWebGL: build.forceWebGL });

  // Built before the host so the engine can mix into it. A browser will not
  // start it here — that takes a user gesture, which is what the Start button
  // below is for.
  const audioContext = typeof AudioContext === 'undefined' ? undefined : new AudioContext();

  // Hosted rather than a single engine: a game is a sequence of scenes, and a
  // script that moves to the next one has to reach something that can.
  const host = new SceneHost({
    source: {
      // By name, resolved through the map the exporter wrote: the entry scene
      // is renamed to `scene.json` here, so the project's paths do not survive.
      read: async (name: string) => {
        const file = build.sceneMap?.[name];
        if (file === undefined) throw new Error(`This build has no scene named "${name}".`);
        // Encoded like an asset path: a scene called `My Level` ships as
        // `scenes/My Level.scene.json`, which is a name and not yet a URL.
        return deserializeScene(await (await fetch(encodePath(file))).text());
      },
    },
    resolver: buildResolver(assetPaths, build.textureEncodings, build.assetSettings),
    materials,
    prefabs,
    loadingScene: build.loadingScene ?? null,
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
  startButton.hidden = false;
  startButton.addEventListener('click', () => {
    overlay.hidden = true;
    canvas.focus();
    // The gesture the whole page exists to collect, as far as audio is
    // concerned: a context created without one stays suspended, and a build
    // that is silent for that reason says nothing about it anywhere.
    void host.engine?.audio?.unlock();
  });

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
}

boot().catch((cause: unknown) => {
  const text = cause instanceof Error ? cause.message : String(cause);
  if (message) message.textContent = `Could not start: ${text}`;
  console.error('[studio] boot failed:', cause);
});
