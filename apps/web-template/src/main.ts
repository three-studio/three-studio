import {
  BUILD_FORMAT_VERSION,
  type AssetSettings,
  type BuildManifest,
  type TextureEncoding,
  SCRIPT_API_VERSION,
  buildScenePath,
  createRenderingSettings,
  deserializeScene,
  encodePath,
  type MaterialDef,
  type PrefabDoc,
  type RenderingSettings,
  type SceneDoc,
} from '@three-studio/core';
import { SceneHost } from '@three-studio/runtime/SceneHost';
import { entrySceneName, sceneIdOf } from './scenes';
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
 *   build.json          the manifest: what the profile chose, the scene list,
 *                       and the asset table, materials and prefabs — see
 *                       `BuildManifest`
 *   scenes/<id>.json    every scene, the entry point first in `build.scenes`
 *   scripts.mjs         the compiled behaviours, absent when the project has
 *                       none
 *
 * Three, and it used to be six: the asset table, the materials and the prefabs
 * were files of their own. They are small and always needed, so they were three
 * round trips spent to learn nothing.
 */

/**
 * The three documents the manifest carries, however they arrive.
 *
 * `Required<Pick<…>>` rather than a shape of its own: they are optional on
 * `BuildManifest` because an older build has them elsewhere, and by the time
 * they are here that question is settled. Naming the fields again would be the
 * fourth declaration of a manifest this commit reduced to one.
 */
type BuildDocuments = Required<Pick<BuildManifest, 'assets' | 'materials' | 'prefabs'>>;

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

/**
 * The asset table, the materials and the prefabs — from the manifest, or from
 * the three files they used to be.
 *
 * Format 4 folded them in, and this still reads the older shape. Written
 * together by one export, so one of them being absent means all three are.
 *
 * **Format 5 put that branch out of reach**, and it is worth knowing why rather
 * than finding out: moving every scene under `scenes/<id>.json` is not a field
 * with a default, so a build old enough to take this path has its scenes
 * somewhere this player never looks and fails on the next line anyway. The same
 * is now true of every optional field on `BuildManifest` — which is one
 * decision to take in one pass, not six times in six places, so this is left
 * standing until it is taken.
 */
async function documentsOf(build: BuildManifest): Promise<BuildDocuments> {
  const { assets, materials, prefabs } = build;
  if (assets !== undefined && materials !== undefined && prefabs !== undefined) {
    return { assets, materials, prefabs };
  }
  const [fetched, fetchedMaterials, fetchedPrefabs] = await Promise.all([
    fetchJson<Record<string, string>>('assets.json'),
    fetchJson<Record<string, MaterialDef>>('materials.json'),
    fetchJson<Record<string, PrefabDoc>>('prefabs.json'),
  ]);
  return { assets: fetched, materials: fetchedMaterials, prefabs: fetchedPrefabs };
}

/**
 * One scene, by whichever half of its identity was named.
 *
 * The only place a scene's URL is formed, and it is *formed* rather than looked
 * up: `buildScenePath` is the same function the exporter wrote the file with,
 * so the two cannot disagree. Still encoded — a scene file carrying no id of
 * its own is addressed by its project path, which can hold spaces.
 */
async function readScene(build: BuildManifest, named: string): Promise<SceneDoc> {
  const path = buildScenePath(sceneIdOf(build, named));
  const response = await fetch(encodePath(path));
  // Named, so a missing scene reads as a missing scene. Without it a static
  // server's 404 page is handed to the parser, which reports a syntax error.
  if (!response.ok) throw new Error(`${path}: ${response.status} ${response.statusText}`);
  return deserializeScene(await response.text());
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

  const build = await fetchJson<BuildManifest>('build.json');
  // Checked before the data is touched: a player reading a build it does not
  // understand should say so, not fail on a field it expected to be there.
  const version = build.formatVersion ?? 0;
  if (version > BUILD_FORMAT_VERSION) {
    throw new Error(
      `This build was produced by a newer version of the editor (format ${version}; this player reads up to ${BUILD_FORMAT_VERSION}). Re-export it, or use the player that came with it.`,
    );
  }

  /*
   * The entry scene can only be asked for once the manifest has arrived, since
   * the manifest is what names it. It used to be `scene.json` and could go out
   * in the same breath as `build.json`; that fixed name is exactly the
   * asymmetry format 5 removed, and one round trip is what it cost.
   */
  const entryId = build.scenes[0];
  if (entryId === undefined) throw new Error('This build lists no scene to start on.');
  const [{ assets: assetPaths, materials, prefabs }, scene] = await Promise.all([
    documentsOf(build),
    readScene(build, entryId),
  ]);

  await loadScripts(build.scripts ?? null);

  /*
   * One reading of the settings, shared by the renderer and the engine — the
   * same shape the editor viewport uses. This is the third of the three modes
   * that used to answer the question for itself.
   */
  const rendering: RenderingSettings = build.rendering ?? {
    ...createRenderingSettings(),
    forceWebGL: build.forceWebGL,
  };

  const { renderer } = await createRenderer({
    canvas,
    forceWebGL: rendering.forceWebGL,
    antialias: rendering.antialias,
    maxPixelRatio: rendering.maxPixelRatio,
    shadows: rendering.shadows,
    exposure: rendering.exposure,
  });

  // Built before the host so the engine can mix into it. A browser will not
  // start it here — that takes a user gesture, which is what the Start button
  // below is for.
  const audioContext = typeof AudioContext === 'undefined' ? undefined : new AudioContext();

  // Hosted rather than a single engine: a game is a sequence of scenes, and a
  // script that moves to the next one has to reach something that can.
  const host = new SceneHost({
    source: {
      // By id, or by the name a script held: `sceneIdOf` turns one into the
      // other, and the id is what says where the file is.
      read: (named: string) => readScene(build, named),
    },
    resolver: buildResolver(assetPaths, build.textureEncodings, build.assetSettings),
    materials,
    prefabs,
    loadingScene: build.loadingScene ?? null,
    rendering,
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
