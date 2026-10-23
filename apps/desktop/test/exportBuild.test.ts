import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  ASSETS_DIR,
  BUILD_FORMAT_VERSION,
  BUILD_LAYOUT,
  PROJECT_FILE_NAME,
  PROJECT_FORMAT_VERSION,
  SCENES_DIR,
  createBuildProfiles,
  createComponent,
  createMaterial,
  createMeshEntity,
  createAudioSourceEntity,
  createPhysicsSettings,
  createRenderingSettings,
  createStarterScene,
  deserializeScene,
  insertEntity,
  putComponent,
  serializeScene,
  type BuildManifest,
  type BuildProfile,
  type MeshComponent,
  type PhysicsSettings,
  type ProjectFile,
  type RenderingSettings,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { readMaterialAssets } from '../src/main/assetLibraries';
import { readAssetMeta, scanAssets } from '../src/main/assetScan';
import { buildScripts } from '../src/main/scripts';
import { BUILD_FILES_NAME, verifyBuild, type BuildFileList } from '../src/main/build/buildFiles';
import { exportBuild, requireBuildProfile } from '../src/main/build/exportBuild';

/*
 * The export is the one place the editor writes something a stranger runs, so
 * what ends up in the folder is worth pinning: the wrong asset missing is a
 * build that loads and shows nothing.
 */

async function writeAsset(
  root: string,
  path: string,
  id: string,
  kind: string,
  settings: Record<string, unknown> = {},
): Promise<void> {
  const file = join(root, path);
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, 'x', 'utf8');
  await writeFile(
    `${file}.meta.json`,
    JSON.stringify({
      version: 1,
      id,
      kind,
      importedAt: 1,
      hash: 'h',
      settings: { kind, ...settings },
    }),
    'utf8',
  );
}

/**
 * A project with a texture used by a material, an HDR used by the environment,
 * one unused texture, and a template to copy.
 *
 * The HDR earns its place in the shared fixture rather than a test of its own:
 * it is named by `scene.environment` and by nothing else, and the collector
 * used to walk only the component tables. So it shipped in no build, and a
 * scene that was right in the editor came up with no sky and every surface
 * unlit — with no warning, because the exporter only reports the opposite case.
 */
async function makeProject(
  rendering: RenderingSettings = createRenderingSettings(),
  physics: PhysicsSettings = createPhysicsSettings(),
): Promise<{ projectPath: string; templateRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), 'studio-export-'));
  const projectPath = join(root, 'project');
  await mkdir(join(projectPath, SCENES_DIR), { recursive: true });

  await writeAsset(projectPath, `${ASSETS_DIR}/textures/used.png`, 'tex-used', 'texture');
  await writeAsset(projectPath, `${ASSETS_DIR}/textures/spare.png`, 'tex-spare', 'texture');
  await writeAsset(projectPath, `${ASSETS_DIR}/textures/sky.hdr`, 'tex-sky', 'texture');
  // A clip, with the facts the import dialog reads off it. Nothing about audio
  // is special in the copy loop, and this is what proves it: the exporter has
  // one kind-specific branch and it is for scripts.
  await writeAsset(projectPath, `${ASSETS_DIR}/audio/beep.wav`, 'clip-beep', 'audio', {
    loadMode: 'decode',
    gain: 0.5,
    forceMono: true,
    seconds: 1.5,
  });

  const scene = createStarterScene();
  const cube = createMeshEntity('box');
  (cube.components[0] as MeshComponent).material = { ...createMaterial(), colorMap: 'tex-used' };
  insertEntity(scene, cube);
  // One image in both slots, which is the usual way a scene is lit.
  scene.environment.backgroundMode = 'texture';
  scene.environment.backgroundTexture = 'tex-sky';
  scene.environment.environmentTexture = 'tex-sky';
  insertEntity(scene, createAudioSourceEntity('clip-beep', 'Beep'));
  await writeFile(join(projectPath, SCENES_DIR, 'main.scene.json'), serializeScene(scene), 'utf8');

  const project: ProjectFile = {
    version: PROJECT_FORMAT_VERSION,
    name: 'Export Test',
    engineVersion: '0.1.0',
    startScene: scene.id,
    settings: {
      loadingScene: null,
      rendering,
      physics,
      build: createBuildProfiles('Export Test'),
    },
  };
  await writeFile(join(projectPath, PROJECT_FILE_NAME), JSON.stringify(project), 'utf8');

  // Stands in for `apps/web-template/dist`, which the exporter copies wholesale.
  const templateRoot = join(root, 'roots');
  const template = join(templateRoot, 'web-template');
  await mkdir(join(template, 'player'), { recursive: true });
  // Shaped like what Vite emits, not a bare doctype: the base URL is written
  // into `<head>`, and a fixture with no head would pass a test the real
  // template fails.
  await writeFile(join(template, 'index.html'), TEMPLATE_HTML, 'utf8');
  await writeFile(join(template, 'player', 'player.js'), '// player', 'utf8');

  return { projectPath, templateRoot };
}

const TEMPLATE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Studio Build</title>
    <link rel="icon" href="./favicon.svg" />
    <script type="module" crossorigin src="./player/player.js"></script>
  </head>
  <body><canvas id="view"></canvas></body>
</html>
`;

/** The page an export writes with no base: the template, titled after the game. */
const PAGE = TEMPLATE_HTML.replace('<title>Studio Build</title>', '<title>Export Test</title>');

const manifestOf = (json: string): BuildManifest => JSON.parse(json) as BuildManifest;

/** The manifest an export wrote, read against the declaration the exporter writes to. */
const buildOf = async (outputDir: string): Promise<BuildManifest> =>
  manifestOf(await readFile(join(outputDir, ...BUILD_LAYOUT.manifest.split('/')), 'utf8'));

/** Where a path the manifest holds is on disk: relative to the manifest, in `game/`. */
const inGame = (outputDir: string, path: string): string =>
  join(outputDir, BUILD_LAYOUT.game, ...path.split('/'));

const listOf = async (outputDir: string): Promise<BuildFileList> =>
  JSON.parse(await readFile(join(outputDir, BUILD_FILES_NAME), 'utf8')) as BuildFileList;

function profile(overrides: Partial<BuildProfile> = {}): BuildProfile {
  return {
    name: 'Web',
    target: 'web',
    scenes: [],
    outputDir: null,
    includeAllAssets: false,
    title: 'Export Test',
    basePath: '',
    ...overrides,
  };
}

describe('choosing the profile an export runs', () => {
  /*
   * The one part of the export handler that was a decision rather than a call.
   * It lived in `ipc.ts`, which no test imports, so both refusals had only ever
   * been read.
   */
  const profiles = () => {
    const settings = createBuildProfiles('Races');
    const id = Object.keys(settings.profiles)[0]!;
    settings.profiles[id] = { ...settings.profiles[id]!, outputDir: '/builds/Races' };
    return { settings, id };
  };

  it('takes the active one, which is the whole of the choice', () => {
    const { settings, id } = profiles();
    expect(requireBuildProfile(settings).profile).toBe(settings.profiles[id]);
    expect(requireBuildProfile(settings).outputDir).toBe('/builds/Races');
  });

  it('follows `active` and nothing else, even with another profile to hand', () => {
    // There is no argument for naming a different one, and that is the
    // decision: the Package dialog saves `active` before asking for the export,
    // so a second way to choose would be its copy beating the file's.
    const { settings, id } = profiles();
    settings.profiles['itch'] = { ...settings.profiles[id]!, name: 'itch', outputDir: '/builds/itch' };

    expect(requireBuildProfile(settings).outputDir).toBe('/builds/Races');

    settings.active = 'itch';
    expect(requireBuildProfile(settings).outputDir).toBe('/builds/itch');
  });

  it('refuses an `active` no profile answers to, and says which', () => {
    // Reachable from the renderer: a settings patch may set `active` to any
    // string — the id is the author's — and deleting a profile in another
    // window leaves it pointing at nothing. Naming the id tells those apart
    // from a bug.
    const { settings } = profiles();
    settings.active = 'gone';
    expect(() => requireBuildProfile(settings)).toThrow('No build profile "gone"');
  });

  it('refuses a profile with no output folder, and says where to choose one', () => {
    // The ordinary state of a new profile, so the message names the panel
    // rather than reporting a fault.
    const settings = createBuildProfiles('Races');
    expect(() => requireBuildProfile(settings)).toThrow('has no output folder. Choose one in Package.');
  });
});

describe('asset and material migration', () => {
  it('fills settings a sidecar predates, and material properties a file predates', async () => {
    const { projectPath } = await makeProject();

    // A sidecar from before its kind had settings, and a material from before
    // the slots that came after it. Both shapes existed in this repo.
    const texture = join(projectPath, ASSETS_DIR, 'textures', 'used.png');
    await writeFile(
      `${texture}.meta.json`,
      JSON.stringify({ version: 1, id: 'tex-used', kind: 'texture', importedAt: 1, hash: 'h' }),
      'utf8',
    );
    await mkdir(join(projectPath, ASSETS_DIR, 'materials'), { recursive: true });
    const material = join(projectPath, ASSETS_DIR, 'materials', 'Old.material.json');
    await writeFile(
      material,
      JSON.stringify({ version: 1, material: { color: '#ff0000', roughness: 0.5 } }),
      'utf8',
    );
    await writeFile(
      `${material}.meta.json`,
      JSON.stringify({ version: 1, id: 'mat-old', kind: 'material', importedAt: 1, hash: 'h' }),
      'utf8',
    );

    const meta = await readAssetMeta(texture);
    expect(meta?.settings).toBeDefined();

    const materials = await readMaterialAssets(projectPath);
    // Kept what the file had, filled what it did not.
    expect(materials['mat-old']?.color).toBe('#ff0000');
    expect(materials['mat-old']?.tiling).toEqual([1, 1]);
    expect(materials['mat-old']?.displacementScale).toBeCloseTo(0.1);
  });
});

describe('web export', () => {
  it('writes a folder that carries the player, the scene and what it references', async () => {
    const { projectPath, templateRoot } = await makeProject();
    const outputDir = join(projectPath, '..', 'out');

    const result = await exportBuild(projectPath, profile(), outputDir, [templateRoot]);

    // The player, copied as-is.
    expect(await readdir(outputDir)).toContain('index.html');
    expect(await readdir(join(outputDir, 'player'))).toContain('player.js');

    // Read once, and against the declaration the exporter writes to: an inline
    // shape here would be a fourth statement of the same manifest.
    const build = await buildOf(outputDir);

    /*
     * The scene, at the path the manifest gives: named after the scene, for
     * whoever opens the folder, and by its content, so a cache never mixes two
     * builds. Nothing at the root: the entry scene used to be renamed to
     * `scene.json` there while the others went under `scenes/`.
     */
    const entry = build.scenes[0]!;
    expect(entry.name).toBe('main');
    expect(entry.path).toMatch(/^scenes\/main\.[0-9a-f]{8}\.json$/);
    expect(await readdir(outputDir)).not.toContain('scene.json');
    const scene = JSON.parse(await readFile(inGame(outputDir, entry.path), 'utf8')) as {
      id: string;
      entities: Record<string, unknown>;
    };
    expect(scene.id).toBe(entry.id);
    expect(Object.keys(scene.entities).length).toBeGreaterThan(0);

    /*
     * Only the referenced texture, and reachable at the path the manifest
     * gives. The name carries eight hex characters of the file's own digest —
     * see `hashedName` — so the assertion is on the shape, and then on the
     * folder holding exactly what the manifest points at.
     */
    const paths = build.assets;
    expect(paths['tex-used']).toMatch(/^assets\/textures\/used\.[0-9a-f]{8}\.png$/);
    // Named by `scene.environment` and by no component. It is also the largest
    // file a scene usually carries, so it is the one whose absence is loudest.
    expect(paths['tex-sky']).toMatch(/^assets\/textures\/sky\.[0-9a-f]{8}\.hdr$/);
    expect(paths['tex-spare']).toBeUndefined();
    expect((await readdir(join(outputDir, 'game', 'assets', 'textures'))).sort()).toEqual(
      [paths['tex-sky']!, paths['tex-used']!].map((path) => basename(path)).sort(),
    );

    expect(build.title).toBe('Export Test');
    // Named, not probed for: a static server that answers unknown paths with
    // its index page returns 200 and HTML, so asking it whether the bundle
    // exists cannot be answered. This project has no scripts.
    expect(build.scripts).toBeNull();
    expect(await readdir(join(outputDir, 'game'))).not.toContain('scripts');

    // The clip travels like anything else. `collectSceneAssets` reaches it
    // through `componentAssets`, which has followed `audioSource.assetId` since
    // long before anything could play it.
    expect(paths['clip-beep']).toMatch(/^assets\/audio\/beep\.[0-9a-f]{8}\.wav$/);

    // Three, not four: the spare texture is not referenced. And three rather
    // than one is the whole point — the sky counts, and so does the sound.
    expect(result).toMatchObject({ sceneCount: 1, assetCount: 3, warnings: [] });
  });

  it('carries the asset table, the materials and the prefabs in the manifest itself', async () => {
    /*
     * Six requests before the first frame, three of them for documents that are
     * small and always needed. Since format 4 they are fields of `build.json`,
     * and the three files are not written any more — which is the half of the
     * change a reader of the player cannot check.
     */
    const { projectPath, templateRoot } = await makeProject();

    // A shared material, so the field carries something rather than an empty
    // object: what has to survive the move is the content, not the key.
    await mkdir(join(projectPath, ASSETS_DIR, 'materials'), { recursive: true });
    const materialFile = join(projectPath, ASSETS_DIR, 'materials', 'Shared.material.json');
    await writeFile(
      materialFile,
      JSON.stringify({ version: 1, material: { ...createMaterial(), color: '#00ff00' } }),
      'utf8',
    );
    await writeFile(
      `${materialFile}.meta.json`,
      JSON.stringify({ version: 1, id: 'mat-shared', kind: 'material', importedAt: 1, hash: 'h' }),
      'utf8',
    );
    const scenePath = join(projectPath, SCENES_DIR, 'main.scene.json');
    const scene = deserializeScene(await readFile(scenePath, 'utf8'));
    for (const held of Object.values(scene.components.mesh)) {
      for (const mesh of Object.values(held)) mesh.materialId = 'mat-shared';
    }
    await writeFile(scenePath, serializeScene(scene), 'utf8');

    const outputDir = join(projectPath, '..', 'out-manifest');
    await exportBuild(projectPath, profile(), outputDir, [templateRoot]);

    const build = await buildOf(outputDir);
    expect(build.formatVersion).toBe(BUILD_FORMAT_VERSION);
    expect(build.assets['tex-used']).toMatch(/^assets\/textures\/used\./);
    expect(build.materials['mat-shared']).toMatchObject({ color: '#00ff00' });
    // An object rather than absent, as every field of the manifest is.
    expect(build.prefabs).toEqual({});

    const files = await readdir(outputDir);
    for (const gone of ['assets.json', 'materials.json', 'prefabs.json']) {
      expect(files).not.toContain(gone);
    }
  });

  it('renames an asset whose bytes changed, so a re-export is not served stale', async () => {
    /*
     * The bug this closes was silent and only ever hit people who had already
     * visited the page: the player bundle was hashed by Vite from the start,
     * the project's own files were not, so a re-exported texture kept its URL
     * and the browser went on serving the one it had.
     *
     * The file is rewritten *outside* the editor, which is the case that decides
     * where the digest comes from. `AssetMeta.hash` is taken at import and
     * refreshed only when the editor itself rewrites a material or a prefab, so
     * a texture edited in another program keeps it for ever — reusing it here
     * would have reproduced the very bug, for the commonest way of hitting it.
     */
    const { projectPath, templateRoot } = await makeProject();
    const outputDir = join(projectPath, '..', 'out-rehash');
    const texture = join(projectPath, ASSETS_DIR, 'textures', 'used.png');

    await exportBuild(projectPath, profile(), outputDir, [templateRoot]);
    const before = await buildOf(outputDir);

    await writeFile(texture, 'something else entirely', 'utf8');
    await exportBuild(projectPath, profile(), outputDir, [templateRoot]);
    const after = await buildOf(outputDir);

    expect(after.assets?.['tex-used']).not.toBe(before.assets?.['tex-used']);
    // The one that did not change keeps its name, or the hash would be naming
    // the export rather than the file.
    expect(after.assets?.['tex-sky']).toBe(before.assets?.['tex-sky']);

    // And the folder holds one of it, not two. A hashed copy lands beside its
    // predecessor rather than over it, so without taking the old one back a
    // folder re-exported through a morning of tweaking carries every round.
    const shipped = await readdir(join(outputDir, 'game', 'assets', 'textures'));
    expect(shipped).toContain(basename(after.assets!['tex-used']!));
    expect(shipped).not.toContain(basename(before.assets!['tex-used']!));
  });

  it('ships what a clip was imported with, so the build sounds like the editor', async () => {
    // `gain` and `forceMono` are read at decode time by the runtime's clip
    // cache. A build that shipped without them would play every sound at the
    // wrong level, and in stereo where the panner wants mono.
    const { projectPath, templateRoot } = await makeProject();
    const outputDir = join(projectPath, '..', 'out');

    await exportBuild(projectPath, profile(), outputDir, [templateRoot]);

    const build = await buildOf(outputDir);
    expect(build.assetSettings['clip-beep']).toMatchObject({
      kind: 'audio',
      gain: 0.5,
      forceMono: true,
      seconds: 1.5,
    });
  });

  it('carries the rendering settings, so the build draws what the editor drew', async () => {
    /*
     * Only `forceWebGL` used to travel. The other five were dropped, and the
     * loss was silent because `createRenderer`'s defaults agreed with the
     * factory's: a project asking for 4096 shadow maps got 4096 in the viewport
     * and 2048 in the build, with nothing anywhere saying why.
     */
    const rendering: RenderingSettings = {
      ...createRenderingSettings(),
      shadowMapSize: 4096,
      antialias: false,
      exposure: 1.5,
      batching: false,
    };
    const { projectPath, templateRoot } = await makeProject(rendering);
    const outputDir = join(projectPath, '..', 'out-rendering');

    await exportBuild(projectPath, profile(), outputDir, [templateRoot]);

    const build = await buildOf(outputDir);
    expect(build.rendering).toEqual(rendering);
  });

  it('carries the physics settings, so the build falls the way the editor did', async () => {
    /*
     * Nothing about physics used to travel, and the player passed nothing to
     * the engine, so every build ran on the factory's gravity and step: a
     * project tuned for low gravity played it in the editor and lost it in the
     * thing people download.
     */
    const physics: PhysicsSettings = { gravity: [0, -3, 0], fixedTimestep: 1 / 120, maxSubsteps: 5 };
    const { projectPath, templateRoot } = await makeProject(createRenderingSettings(), physics);
    const outputDir = join(projectPath, '..', 'out-physics');

    await exportBuild(projectPath, profile(), outputDir, [templateRoot]);

    const build = await buildOf(outputDir);
    expect(build.physics).toEqual(physics);
    expect(build.formatVersion).toBe(7);
  });

  it('tells the player which images its file names do not describe', async () => {
    const { projectPath, templateRoot } = await makeProject();
    // An Ultra HDR image is a `.jpg`. Without a word from the exporter the
    // player sends it through the ordinary image path, where it decodes
    // perfectly and loses every stop of range above white — a sky that casts
    // no light, with nothing anywhere saying why.
    const jpeg = join(projectPath, ASSETS_DIR, 'textures', 'gain.jpg');
    await writeFile(
      jpeg,
      Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), Buffer.from('hdrgm:Version', 'latin1')]),
    );

    const outputDir = join(projectPath, '..', 'out-encodings');
    await exportBuild(projectPath, profile({ includeAllAssets: true }), outputDir, [templateRoot]);

    const build = await buildOf(outputDir);
    const manifest = await scanAssets(projectPath);
    const gain = manifest.assets.find((asset) => asset.path.endsWith('gain.jpg'))!;
    expect(build.textureEncodings[gain.id]).toBe('ultrahdr');

    // Only the ones that need saying. Radiance and PNG are named by their
    // extension, and listing them would be a second place to keep in step.
    expect(Object.keys(build.textureEncodings)).toEqual([gain.id]);
  });

  it('says when a name of the project will not be published by GitHub Pages', async () => {
    // Jekyll leaves out every path starting with "_", at any depth.
    const { projectPath, templateRoot } = await makeProject();
    await writeAsset(projectPath, `${ASSETS_DIR}/_shared/stone.png`, 'tex-stone', 'texture');
    const outputDir = join(projectPath, '..', 'out-underscore');

    const plain = await exportBuild(projectPath, profile(), outputDir, [templateRoot]);
    expect(plain.warnings).toEqual([]);

    const result = await exportBuild(projectPath, profile({ includeAllAssets: true }), outputDir, [
      templateRoot,
    ]);
    expect(result.warnings.join('\n')).toMatch(/\.nojekyll file: game\/assets\/_shared\/stone\./);
  });

  it('ships every asset when the profile asks for it', async () => {
    const { projectPath, templateRoot } = await makeProject();
    const outputDir = join(projectPath, '..', 'out-all');

    const result = await exportBuild(
      projectPath,
      profile({ includeAllAssets: true }),
      outputDir,
      [templateRoot],
    );

    // Unreal's "cook everything": a script can load an asset by name, which no
    // static walk of the scene can see.
    expect(result.assetCount).toBe(4);
    const shipped = await readdir(join(outputDir, 'game', 'assets', 'textures'));
    expect(shipped.map((file) => file.replace(/\.[0-9a-f]{8}\./, '.')).sort()).toEqual([
      'sky.hdr',
      'spare.png',
      'used.png',
    ]);
  });

  it('refuses to write into the project, and leaves its assets and scenes as they were', async () => {
    // The export empties the build's `assets/` and `scenes/`, which in the
    // project's own folder are the project's.
    const { projectPath, templateRoot } = await makeProject();
    const before = await readdir(join(projectPath, ASSETS_DIR, 'textures'));

    await expect(exportBuild(projectPath, profile(), projectPath, [templateRoot])).rejects.toThrow(
      /project itself/,
    );
    expect(await readdir(join(projectPath, ASSETS_DIR, 'textures'))).toEqual(before);
    expect(await readdir(join(projectPath, SCENES_DIR))).toContain('main.scene.json');
  });

  it('refuses a second export into a folder while the first is still writing', async () => {
    const { projectPath, templateRoot } = await makeProject();
    const outputDir = join(projectPath, '..', 'out-twice');

    const [first, second] = await Promise.allSettled([
      exportBuild(projectPath, profile(), outputDir, [templateRoot]),
      exportBuild(projectPath, profile(), outputDir, [templateRoot]),
    ]);
    expect([first.status, second.status].sort()).toEqual(['fulfilled', 'rejected']);
    const refused = first.status === 'rejected' ? first : second;
    expect(String((refused as PromiseRejectedResult).reason)).toMatch(/already running/);
  });

  it('refuses when the player has not been built', async () => {
    const { projectPath } = await makeProject();
    await expect(
      exportBuild(projectPath, profile(), join(projectPath, '..', 'out-none'), []),
    ).rejects.toThrow(/has not been built/);
  });
});

/*
 * One `<base>` carries every URL in the build — the player bundle, the favicon,
 * the JSON documents, the assets and the script bundle are all resolved against
 * the document. So what this describes is the whole of the base URL feature,
 * and the page is the only place it can be got wrong.
 */
describe('a profile that names a scene the project no longer has', () => {
  /*
   * A profile is written once; the scenes it names live in the Finder, where
   * one can be deleted or moved out months later. Refusing the whole export for
   * that would mean the author cannot ship the levels that are still there —
   * so it is a warning, in the same place the missing-asset warnings go.
   *
   * This is what lets a deletion stop rewriting build profiles: the export was
   * always going to have to survive an id with no file, because a deletion in
   * the Finder never went through the editor. See `sceneOperations.test.ts`.
   */
  it('warns and ships the scenes that are left', async () => {
    const { projectPath, templateRoot } = await makeProject();
    const outputDir = join(projectPath, '..', 'out');
    const scene = deserializeScene(
      await readFile(join(projectPath, SCENES_DIR, 'main.scene.json'), 'utf8'),
    );

    const result = await exportBuild(
      projectPath,
      profile({ scenes: [scene.id, 'a-scene-that-was-deleted'] }),
      outputDir,
      [templateRoot],
    );

    expect(result.sceneCount).toBe(1);
    expect(result.warnings.join(' ')).toMatch(/a-scene-that-was-deleted/);
    // And the build is a build: the scene that is left is there, and it is the
    // one the manifest names first.
    const build = await buildOf(outputDir);
    expect(build.scenes.map(({ id }) => id)).toEqual([scene.id]);
    expect(await readdir(join(outputDir, 'game', 'scenes'))).toEqual([
      build.scenes[0]!.path.slice('scenes/'.length),
    ]);
  });

  /*
   * None of them resolving is different in kind. A folder with no `scene.json`
   * is a black page rather than a message, so that one does refuse.
   */
  it('refuses when none of them is left', async () => {
    const { projectPath, templateRoot } = await makeProject();
    const outputDir = join(projectPath, '..', 'out');

    await expect(
      exportBuild(projectPath, profile({ scenes: ['gone', 'also-gone'] }), outputDir, [
        templateRoot,
      ]),
    ).rejects.toThrow(/no scene/i);
  });
});

describe('base URL', () => {
  const indexOf = async (outputDir: string): Promise<string> =>
    readFile(join(outputDir, 'index.html'), 'utf8');

  it('leaves the page untouched when no base is set', async () => {
    const { projectPath, templateRoot } = await makeProject();
    const outputDir = join(projectPath, '..', 'out-none');

    await exportBuild(projectPath, profile(), outputDir, [templateRoot]);

    // Byte for byte the template but for its title: an empty base is what
    // every build produced before this field existed, and it has to stay that.
    expect(await indexOf(outputDir)).toBe(PAGE);
  });

  it('treats "." and "./" as no base at all', async () => {
    const { projectPath, templateRoot } = await makeProject();
    for (const [index, basePath] of ['.', './', '  '].entries()) {
      const outputDir = join(projectPath, '..', `out-dot-${index}`);
      await exportBuild(projectPath, profile({ basePath }), outputDir, [templateRoot]);
      // All three resolve against the document, which is what the untagged page
      // already does. A tag saying so would be a difference with no effect.
      expect(await indexOf(outputDir)).toBe(PAGE);
    }
  });

  it('writes the base ahead of every URL the page carries', async () => {
    const { projectPath, templateRoot } = await makeProject();
    const outputDir = join(projectPath, '..', 'out-root');

    await exportBuild(projectPath, profile({ basePath: '/' }), outputDir, [templateRoot]);

    const html = await indexOf(outputDir);
    expect(html).toContain('<base href="/" />');
    // Ahead of them, because a base only governs what follows it.
    expect(html.indexOf('<base')).toBeLessThan(html.indexOf('<link rel="icon"'));
    expect(html.indexOf('<base')).toBeLessThan(html.indexOf('<script type="module"'));
  });

  it('adds the trailing slash a base cannot do without', async () => {
    const { projectPath, templateRoot } = await makeProject();
    const outputDir = join(projectPath, '..', 'out-sub');

    await exportBuild(projectPath, profile({ basePath: '/games/demo' }), outputDir, [templateRoot]);

    // Without it, `assets/x.png` resolves to `/games/assets/x.png` — one level
    // too high, and every file in the build a 404.
    expect(await indexOf(outputDir)).toContain('<base href="/games/demo/" />');
  });

  it('writes a base carrying $ literally', async () => {
    const { projectPath, templateRoot } = await makeProject();
    const outputDir = join(projectPath, '..', 'out-dollar');

    await exportBuild(projectPath, profile({ basePath: 'https://host/v$1/' }), outputDir, [
      templateRoot,
    ]);

    // `String.replace` reads `$1` out of a replacement *string* and writes the
    // captured group in its place. This is the test that keeps the replacer a
    // function.
    expect(await indexOf(outputDir)).toContain('<base href="https://host/v$1/" />');
  });

  it('warns about an absolute base, protocol-relative included', async () => {
    const { projectPath, templateRoot } = await makeProject();

    for (const [index, basePath] of ['http://localhost:8080', '//cdn.example.com'].entries()) {
      const outputDir = join(projectPath, '..', `out-abs-${index}`);
      const result = await exportBuild(projectPath, profile({ basePath }), outputDir, [
        templateRoot,
      ]);
      expect(await indexOf(outputDir)).toContain(`<base href="${basePath}/" />`);
      // Conditional, not a verdict: the exporter does not know which origin the
      // page will be served from, so it cannot say this one is a different one.
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toMatch(/Access-Control-Allow-Origin/);
    }
  });

  it('does not warn about a base that stays on one origin', async () => {
    const { projectPath, templateRoot } = await makeProject();
    const outputDir = join(projectPath, '..', 'out-rel');

    const base = profile({ basePath: '/games/demo/' });
    const result = await exportBuild(projectPath, base, outputDir, [
      templateRoot,
    ]);

    expect(result.warnings).toEqual([]);
  });

  it('refuses a base carrying a query or a fragment, before writing anything', async () => {
    const { projectPath, templateRoot } = await makeProject();
    const outputDir = join(projectPath, '..', 'out-query');

    // Normalizing would run straight through it and produce `?v=1/`.
    await expect(
      exportBuild(projectPath, profile({ basePath: '/app?v=1' }), outputDir, [templateRoot]),
    ).rejects.toThrow(/query or a fragment/);
    // Refused before the folder was touched, so the author is not left with a
    // half-written build to clean up.
    await expect(readdir(outputDir)).rejects.toThrow();
  });

  it('drops the base of a previous export when the field is cleared', async () => {
    const { projectPath, templateRoot } = await makeProject();
    const outputDir = join(projectPath, '..', 'out-again');

    await exportBuild(projectPath, profile({ basePath: '/demo/' }), outputDir, [templateRoot]);
    expect(await indexOf(outputDir)).toContain('<base');

    // The copy overwrites `index.html` with the pristine template, so nothing
    // is left of the last base. Nothing else guarantees that.
    await exportBuild(projectPath, profile(), outputDir, [templateRoot]);
    expect(await indexOf(outputDir)).toBe(PAGE);
  });

  it('titles the page after the game, as text', async () => {
    // What a tab shows before any script has run, and what a link preview
    // shows, which runs none. Every game used to be "Studio Build" there.
    const { projectPath, templateRoot } = await makeProject();
    const outputDir = join(projectPath, '..', 'out-title');

    await exportBuild(
      projectPath,
      profile({ title: 'Tom & Jerry <3 $& more', basePath: '/demo/' }),
      outputDir,
      [templateRoot],
    );
    const html = await indexOf(outputDir);
    expect(html).toContain('<title>Tom &amp; Jerry &lt;3 $&amp; more</title>');
    expect(html).toContain('<base href="/demo/" />');
    expect(html).not.toContain('Studio Build');

    // No title of its own: the project's name, rather than a tab saying nothing.
    await exportBuild(projectPath, profile({ title: '  ' }), outputDir, [templateRoot]);
    expect(await indexOf(outputDir)).toContain('<title>Export Test</title>');
  });

  it('refuses a player page with no head to put the base in', async () => {
    const { projectPath, templateRoot } = await makeProject();
    await writeFile(
      join(templateRoot, 'web-template', 'index.html'),
      '<!doctype html><body></body>',
      'utf8',
    );

    await expect(
      exportBuild(projectPath, profile({ basePath: '/' }), join(projectPath, '..', 'out-nohead'), [
        templateRoot,
      ]),
    ).rejects.toThrow(/no <head>/);
  });
});

/*
 * `.gltf` and `.obj` name their companions inside the file, not by asset id, so
 * nothing the scene references accounts for them. A build that shipped the
 * model without them would load and draw nothing.
 */
describe('models that come with other files', () => {
  it('ships a glTF with its buffer and its images', async () => {
    const { projectPath, templateRoot } = await makeProject();
    const models = join(projectPath, ASSETS_DIR, 'models', 'Tri');
    await mkdir(join(models, 'maps'), { recursive: true });
    await writeFile(join(models, 'Tri.bin'), 'binary', 'utf8');
    await writeFile(join(models, 'maps', 'albedo.png'), 'png', 'utf8');
    await writeAsset(
      projectPath,
      `${ASSETS_DIR}/models/Tri/Tri.gltf`,
      'model-tri',
      'model',
    );
    // Overwrite the placeholder body with a document that names its companions.
    await writeFile(
      join(models, 'Tri.gltf'),
      JSON.stringify({
        asset: { version: '2.0' },
        buffers: [{ uri: 'Tri.bin' }],
        images: [{ uri: 'maps/albedo.png' }, { uri: 'data:image/png;base64,AAAA' }],
      }),
      'utf8',
    );

    const scene = deserializeScene(
      await readFile(join(projectPath, SCENES_DIR, 'main.scene.json'), 'utf8'),
    );
    const entityId = Object.keys(scene.entities)[0]!;
    putComponent(scene, entityId, { ...createComponent('model'), assetId: 'model-tri' });
    await writeFile(
      join(projectPath, SCENES_DIR, 'main.scene.json'),
      JSON.stringify(scene),
      'utf8',
    );

    const outputDir = join(projectPath, '..', 'out-gltf');
    const result = await exportBuild(projectPath, profile(), outputDir, [templateRoot]);
    // A data URI is already inside the file and is not a path to copy.
    expect(result.warnings).toEqual([]);

    /*
     * One folder for the model and everything it names, named by all of them.
     * The side files keep their names — they are written *inside* the `.gltf`,
     * relative to it — and the folder is what carries the hash.
     */
    const model = (await buildOf(outputDir)).assets['model-tri']!;
    expect(model).toMatch(/^assets\/models\/Tri\/Tri\.[0-9a-f]{8}\/Tri\.gltf$/);
    const shipped = join(inGame(outputDir, model), '..');
    expect(await readFile(join(shipped, 'Tri.bin'), 'utf8')).toBe('binary');
    expect(await readFile(join(shipped, 'maps', 'albedo.png'), 'utf8')).toBe('png');
    expect((await listOf(outputDir)).files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        `game/${model}`,
        `game/${model.replace('Tri.gltf', 'Tri.bin')}`,
        `game/${model.replace('Tri.gltf', 'maps/albedo.png')}`,
      ]),
    );
    expect((await verifyBuild(outputDir)).ok).toBe(true);

    /*
     * A side file edited after an export used to keep its URL, the model's
     * name did not change, and a visitor who had seen the model was served the
     * old texture from the cache. Any of them changing is a new folder.
     */
    await writeFile(join(models, 'maps', 'albedo.png'), 'repainted', 'utf8');
    await exportBuild(projectPath, profile(), outputDir, [templateRoot]);
    const repainted = (await buildOf(outputDir)).assets['model-tri']!;
    expect(repainted).not.toBe(model);
    expect(await readFile(join(inGame(outputDir, repainted), '..', 'maps', 'albedo.png'), 'utf8')).toBe(
      'repainted',
    );
  });

  it('ships nothing a model names outside its own folder', async () => {
    // `%2e%2e` decodes to `..`. The name was checked before it was decoded, so
    // the export copied a file from beside the project into the build — and,
    // the same name joined onto the output, wrote it beside the build too.
    const { projectPath, templateRoot } = await makeProject();
    await writeFile(join(projectPath, '..', 'secret.txt'), 'private', 'utf8');
    await writeAsset(projectPath, `${ASSETS_DIR}/models/Tri.gltf`, 'model-tri', 'model');
    await writeFile(
      join(projectPath, ASSETS_DIR, 'models', 'Tri.gltf'),
      JSON.stringify({
        asset: { version: '2.0' },
        buffers: [{ uri: '%2e%2e/%2e%2e/%2e%2e/secret.txt' }],
      }),
      'utf8',
    );
    const scene = deserializeScene(
      await readFile(join(projectPath, SCENES_DIR, 'main.scene.json'), 'utf8'),
    );
    const entityId = Object.keys(scene.entities)[0]!;
    putComponent(scene, entityId, { ...createComponent('model'), assetId: 'model-tri' });
    await writeFile(join(projectPath, SCENES_DIR, 'main.scene.json'), serializeScene(scene), 'utf8');

    const outputDir = join(projectPath, '..', 'out', 'reaching');
    await exportBuild(projectPath, profile(), outputDir, [templateRoot]);

    const listed = (await listOf(outputDir)).files.map((file) => file.path);
    expect(listed.some((path) => path.endsWith('secret.txt'))).toBe(false);
    // `out/reaching/assets/models` climbed three times is `out/`.
    expect(await readdir(join(projectPath, '..', 'out'))).toEqual(['reaching']);
  });

  it('says so when a companion is named but missing', async () => {
    const { projectPath, templateRoot } = await makeProject();
    await writeAsset(projectPath, `${ASSETS_DIR}/models/Gone.gltf`, 'model-gone', 'model');
    await writeFile(
      join(projectPath, ASSETS_DIR, 'models', 'Gone.gltf'),
      JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'Gone.bin' }] }),
      'utf8',
    );

    const scene = deserializeScene(
      await readFile(join(projectPath, SCENES_DIR, 'main.scene.json'), 'utf8'),
    );
    const entityId = Object.keys(scene.entities)[0]!;
    putComponent(scene, entityId, { ...createComponent('model'), assetId: 'model-gone' });
    await writeFile(join(projectPath, SCENES_DIR, 'main.scene.json'), serializeScene(scene), 'utf8');

    const outputDir = join(projectPath, '..', 'out-missing');
    const result = await exportBuild(projectPath, profile(), outputDir, [templateRoot]);

    // A silent half-export is the thing to avoid: the build runs and the model
    // is simply not there.
    expect(result.warnings.join(' ')).toMatch(/Gone\.bin/);
  });
});

/*
 * Nothing said what a build contained. A CI job publishing one could not tell a
 * complete folder from a half-copied one, and nobody could tell a published
 * folder from a published folder with one file swapped.
 */
describe('the list of what an export wrote', () => {
  it('names the player, the scenes, the assets and the manifest itself', async () => {
    const { projectPath, templateRoot } = await makeProject();
    const outputDir = join(projectPath, '..', 'out-files');

    await exportBuild(projectPath, profile(), outputDir, [templateRoot]);

    const build = await buildOf(outputDir);
    const listed = (await listOf(outputDir)).files;
    const paths = listed.map((file) => file.path);

    // The player arrives as a directory, so the exporter never names its files
    // one by one: they are read off the template, which holds nothing else —
    // never off the output folder, which holds whatever the author keeps there.
    expect((await listOf(outputDir)).formatVersion).toBe(1);
    expect(paths).toContain('index.html');
    expect(paths).toContain('player/player.js');
    expect(paths).toContain(`game/${build.scenes[0]!.path}`);
    expect(paths).toContain(`game/${build.assets['tex-used']!}`);
    // Itself included, and that is what a file of its own buys: a manifest
    // cannot carry its own digest, so `build.json` could not be checked while
    // this list lived inside it.
    expect(paths).toContain(BUILD_LAYOUT.manifest);
    // Everything but the list, which is the one file that cannot describe
    // itself.
    expect(paths).not.toContain(BUILD_FILES_NAME);

    for (const file of listed) {
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(file.bytes).toBeGreaterThan(0);
    }
    // Sorted, so re-exporting an unchanged project writes the same bytes.
    expect(paths).toEqual([...paths].sort());

    expect(await verifyBuild(outputDir)).toEqual({
      ok: true,
      missing: [],
      changed: [],
      unexpected: [],
    });
  });

  it('fails when a byte of the player changes after the export', async () => {
    const { projectPath, templateRoot } = await makeProject();
    const outputDir = join(projectPath, '..', 'out-tampered');
    await exportBuild(projectPath, profile(), outputDir, [templateRoot]);

    const page = join(outputDir, 'index.html');
    await writeFile(page, `${await readFile(page, 'utf8')}<!-- -->`, 'utf8');

    const verified = await verifyBuild(outputDir);
    expect(verified.ok).toBe(false);
    expect(verified.changed).toEqual(['index.html']);
  });

  it('fails when the manifest itself is edited', async () => {
    // The reason the list is a file of its own rather than a field of
    // `build.json`: nothing can hash a document that holds its own hash, so a
    // manifest carrying the list could never be checked.
    const { projectPath, templateRoot } = await makeProject();
    const outputDir = join(projectPath, '..', 'out-manifest-edit');
    await exportBuild(projectPath, profile(), outputDir, [templateRoot]);

    const manifest = join(outputDir, ...BUILD_LAYOUT.manifest.split('/'));
    const build = await buildOf(outputDir);
    await writeFile(manifest, JSON.stringify({ ...build, title: 'Something Else' }), 'utf8');

    expect((await verifyBuild(outputDir)).changed).toEqual([BUILD_LAYOUT.manifest]);
  });

  it('names what has gone missing and what has appeared', async () => {
    const { projectPath, templateRoot } = await makeProject();
    const outputDir = join(projectPath, '..', 'out-moved');
    await exportBuild(projectPath, profile(), outputDir, [templateRoot]);

    await rm(join(outputDir, 'player', 'player.js'));
    await writeFile(join(outputDir, 'player', 'analytics.js'), 'fetch("//elsewhere")', 'utf8');
    // Beside the build rather than in it: the author's, like a README. The
    // player cannot reach it without a change to the page or the manifest,
    // and both are listed.
    await writeFile(join(outputDir, 'notes.txt'), 'todo', 'utf8');

    const verified = await verifyBuild(outputDir);
    expect(verified.missing).toEqual(['player/player.js']);
    // Neither missing nor altered, and reported anyway: a file that appeared
    // among the player's after the export is what an injected one looks like.
    expect(verified.unexpected).toEqual(['player/analytics.js']);
  });

  it('reports a link inside the build, which can point anywhere', async () => {
    const { projectPath, templateRoot } = await makeProject();
    const outputDir = join(projectPath, '..', 'out-linked');
    await exportBuild(projectPath, profile(), outputDir, [templateRoot]);
    const elsewhere = join(projectPath, '..', 'elsewhere.js');
    await writeFile(elsewhere, '// not the player', 'utf8');

    await symlink(elsewhere, join(outputDir, 'player', 'extra.js'));
    await rm(join(outputDir, 'favicon.svg'), { force: true });
    await rm(join(outputDir, 'index.html'));
    await symlink(elsewhere, join(outputDir, 'index.html'));

    const verified = await verifyBuild(outputDir);
    expect(verified.unexpected).toEqual(['player/extra.js']);
    // Whatever it points at, a host serves something other than what was written.
    expect(verified.changed).toEqual(['index.html']);
  });

  it('refuses to check against a list that is not one', async () => {
    // The list is in the folder being verified, so it is the one input a
    // verifier has no reason to trust. Cast rather than read, it sent the
    // verifier hashing files outside the build, or crashed it.
    const { projectPath, templateRoot } = await makeProject();
    const outputDir = join(projectPath, '..', 'out-badlist');
    await exportBuild(projectPath, profile(), outputDir, [templateRoot]);
    const digest = 'a'.repeat(64);

    for (const broken of [
      { formatVersion: 1, files: [{ path: '../../etc/passwd', bytes: 1, sha256: digest }] },
      { formatVersion: 1, files: [{ path: 'index.html', bytes: 1, sha256: 'not a digest' }] },
      { formatVersion: 1, files: [{ path: 'index.html', bytes: -1, sha256: digest }] },
      {
        formatVersion: 1,
        files: [
          { path: 'page.js', bytes: 1, sha256: digest },
          { path: 'Page.js', bytes: 1, sha256: digest },
        ],
      },
      // What an export walked out of the folder before the list had a format.
      { files: [{ path: 'index.html', bytes: 1, sha256: digest }] },
    ]) {
      await writeFile(join(outputDir, BUILD_FILES_NAME), JSON.stringify(broken), 'utf8');
      await expect(verifyBuild(outputDir)).rejects.toThrow(/cannot be checked against/);
    }
  });

  it('takes back a scene it no longer ships, so the folder holds this export alone', async () => {
    /*
     * The list is the plan, so a stale scene would not be in it — but it would
     * still be in the folder, published with the build and reported by every
     * verification after. The export takes back whatever its own folders hold
     * that this build does not.
     */
    const { projectPath, templateRoot } = await makeProject();
    const outputDir = join(projectPath, '..', 'out-stale');
    await exportBuild(projectPath, profile(), outputDir, [templateRoot]);

    // What a scene deleted or renamed in the project leaves behind.
    const scenes = join(outputDir, 'game', 'scenes');
    await writeFile(join(scenes, 'a-scene-since-deleted.1a2b3c4d.json'), '{}', 'utf8');
    await exportBuild(projectPath, profile(), outputDir, [templateRoot]);

    expect(await readdir(scenes)).not.toContain('a-scene-since-deleted.1a2b3c4d.json');
    expect((await verifyBuild(outputDir)).ok).toBe(true);
  });

  it('refuses to verify a folder that carries no list', async () => {
    // "This cannot be verified" is a different answer from "this does not
    // verify", and collapsing the two would report an ordinary folder as a
    // tampered build.
    const { projectPath, templateRoot } = await makeProject();
    const outputDir = join(projectPath, '..', 'out-nolist');
    await exportBuild(projectPath, profile(), outputDir, [templateRoot]);
    await rm(join(outputDir, BUILD_FILES_NAME));

    await expect(verifyBuild(outputDir)).rejects.toThrow(/nothing to check it against/);
  });
});

/*
 * The folder an export writes into is often a repository published as it is —
 * GitHub Pages serves a branch — so it holds the author's `.git/`, README,
 * CNAME and a `.DS_Store` beside the build. The list used to be a walk of the
 * whole folder: `.git/` went into it, every commit changed it, and its 27 MB
 * were reported as the player's weight.
 */
describe('a folder the build shares with its author', () => {
  async function seedRepository(outputDir: string): Promise<Map<string, string>> {
    const files = new Map([
      ['.git/HEAD', 'ref: refs/heads/main\n'],
      ['.git/objects/ab/cdef', 'blob'],
      ['README.md', '# Demo\n'],
      ['CNAME', 'game.example.com\n'],
      ['.DS_Store', 'finder'],
    ]);
    for (const [path, text] of files) {
      const file = join(outputDir, ...path.split('/'));
      await mkdir(join(file, '..'), { recursive: true });
      await writeFile(file, text, 'utf8');
    }
    return files;
  }

  it("leaves the author's files out of the list, and where they were", async () => {
    const { projectPath, templateRoot } = await makeProject();
    const clean = join(projectPath, '..', 'out-clean');
    const shared = join(projectPath, '..', 'out-shared');
    const seeded = await seedRepository(shared);

    const alone = await exportBuild(projectPath, profile(), clean, [templateRoot]);
    const beside = await exportBuild(projectPath, profile(), shared, [templateRoot]);

    const listed = (await listOf(shared)).files.map((file) => file.path);
    for (const [path, text] of seeded) {
      expect(listed).not.toContain(path);
      expect(await readFile(join(shared, ...path.split('/')), 'utf8')).toBe(text);
    }
    // What the author keeps beside a build weighs nothing in it.
    expect(beside.size).toEqual(alone.size);
    expect(await verifyBuild(shared)).toEqual({ ok: true, missing: [], changed: [], unexpected: [] });
  });

  it('writes the same list after the author commits', async () => {
    const { projectPath, templateRoot } = await makeProject();
    const outputDir = join(projectPath, '..', 'out-committed');
    await seedRepository(outputDir);
    await exportBuild(projectPath, profile(), outputDir, [templateRoot]);
    const before = await readFile(join(outputDir, BUILD_FILES_NAME), 'utf8');

    // What a commit does to the folder.
    await writeFile(join(outputDir, '.git', 'HEAD'), 'ref: refs/heads/release\n', 'utf8');
    await mkdir(join(outputDir, '.git', 'objects', '12'), { recursive: true });
    await writeFile(join(outputDir, '.git', 'objects', '12', '3456'), 'commit', 'utf8');
    await exportBuild(projectPath, profile(), outputDir, [templateRoot]);

    expect(await readFile(join(outputDir, BUILD_FILES_NAME), 'utf8')).toBe(before);
  });
});

describe('what a re-export takes back', () => {
  it('a chunk of the player it no longer ships', async () => {
    const { projectPath, templateRoot } = await makeProject();
    const outputDir = join(projectPath, '..', 'out-chunk');
    await exportBuild(projectPath, profile(), outputDir, [templateRoot]);

    // What an older build of the player leaves behind: Vite names a chunk by
    // its content, so the next one lands beside it rather than over it.
    await writeFile(join(outputDir, 'player', 'index-OLD.js'), '// last week', 'utf8');
    await exportBuild(projectPath, profile(), outputDir, [templateRoot]);

    expect(await readdir(join(outputDir, 'player'))).toEqual(['player.js']);
    expect((await verifyBuild(outputDir)).ok).toBe(true);
  });

  it('the script bundle of a project that no longer has scripts', async () => {
    const { projectPath, templateRoot } = await makeProject();
    const outputDir = join(projectPath, '..', 'out-noscripts');
    await exportBuild(projectPath, profile(), outputDir, [templateRoot]);
    await mkdir(join(outputDir, 'game', 'scripts'), { recursive: true });
    await writeFile(join(outputDir, 'game', 'scripts', 'bundle.1a2b3c4d.mjs'), 'export {};', 'utf8');

    await exportBuild(projectPath, profile(), outputDir, [templateRoot]);

    expect(await readdir(join(outputDir, 'game'))).not.toContain('scripts');
    expect((await buildOf(outputDir)).scripts).toBeNull();
  });

  it('a folder spelled differently by the previous build', async () => {
    // A folder renamed from `TEXTURES` to `textures` in the project keeps its
    // old spelling on a volume that ignores case, and the write lands in it —
    // so the build works on the author's disk, and the host, which does not
    // ignore case, answers 404 for every texture.
    const { projectPath, templateRoot } = await makeProject();
    const outputDir = join(projectPath, '..', 'out-case');
    await exportBuild(projectPath, profile(), outputDir, [templateRoot]);
    const assets = join(outputDir, 'game', 'assets');
    // In two steps, so a volume that ignores case renames it at all.
    await rename(join(assets, 'textures'), join(assets, 'renaming'));
    await rename(join(assets, 'renaming'), join(assets, 'TEXTURES'));

    await exportBuild(projectPath, profile(), outputDir, [templateRoot]);

    expect(await readdir(assets)).toContain('textures');
    expect(await readdir(assets)).not.toContain('TEXTURES');
    expect((await verifyBuild(outputDir)).ok).toBe(true);
  });
});

/** Every file under a folder with its bytes, to prove an export that failed changed nothing. */
async function snapshot(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const walk = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await walk(join(directory, entry.name), path);
      else files[path] = (await readFile(join(directory, entry.name))).toString('base64');
    }
  };
  await walk(root, '');
  return files;
}

/*
 * Everything is planned before anything is written, so whatever stops an
 * export stops it while the folder still holds the previous build, whole.
 * A script that did not compile used to be found after `assets/` and
 * `scenes/` had been replaced.
 */
describe('an export that cannot finish', () => {
  it('leaves the folder as it was when a script does not compile', async () => {
    const { projectPath, templateRoot } = await makeProject();
    const outputDir = join(projectPath, '..', 'out-broken');
    await exportBuild(projectPath, profile(), outputDir, [templateRoot]);
    const before = await snapshot(outputDir);

    await writeAsset(projectPath, `${ASSETS_DIR}/scripts/Broken.ts`, 'script-broken', 'script');
    await writeFile(join(projectPath, ASSETS_DIR, 'scripts', 'Broken.ts'), 'export default class {', 'utf8');
    // And a texture that changed, so there is something an early write would replace.
    await writeFile(join(projectPath, ASSETS_DIR, 'textures', 'used.png'), 'repainted', 'utf8');

    await expect(exportBuild(projectPath, profile(), outputDir, [templateRoot])).rejects.toThrow(
      /did not compile/,
    );
    expect(await snapshot(outputDir)).toEqual(before);
  });
});

/*
 * What a build needs that no slot of a scene says it needs. Each of these
 * worked in Play, which runs the whole project, and went missing from the thing
 * people download.
 */
describe('what a scene needs beyond its slots', () => {
  /** Puts a component on the main scene's first entity. */
  async function addToMainScene(projectPath: string, component: object): Promise<void> {
    const file = join(projectPath, SCENES_DIR, 'main.scene.json');
    const scene = deserializeScene(await readFile(file, 'utf8'));
    putComponent(scene, Object.keys(scene.entities)[0]!, component as never);
    await writeFile(file, serializeScene(scene), 'utf8');
  }

  async function setLoadingScene(projectPath: string, id: string): Promise<void> {
    const file = join(projectPath, PROJECT_FILE_NAME);
    const project = JSON.parse(await readFile(file, 'utf8')) as ProjectFile;
    project.settings.loadingScene = id;
    await writeFile(file, JSON.stringify(project), 'utf8');
  }

  it('ships an asset a script was handed in the inspector, and leaves a sentence alone', async () => {
    const { projectPath, templateRoot } = await makeProject();
    await writeAsset(projectPath, `${ASSETS_DIR}/scripts/Door.ts`, 'script-door', 'script');
    await writeFile(
      join(projectPath, ASSETS_DIR, 'scripts', 'Door.ts'),
      'export default class Door {}',
      'utf8',
    );
    await addToMainScene(projectPath, {
      ...createComponent('script'),
      assetId: 'script-door',
      // The spare texture is named by nothing else in the project.
      props: { texture: 'tex-spare', greeting: 'Hello' },
    });
    const outputDir = join(projectPath, '..', 'out-scripted');

    const result = await exportBuild(projectPath, profile(), outputDir, [templateRoot]);

    expect((await buildOf(outputDir)).assets['tex-spare']).toMatch(/^assets\/textures\/spare\./);
    // A string that names no asset is not a reference to a missing one.
    expect(result.warnings).toEqual([]);
  });

  it('ships the loading scene, listed in the profile or not', async () => {
    const { projectPath, templateRoot } = await makeProject();
    const loading = createStarterScene();
    loading.name = 'Loading';
    await writeFile(join(projectPath, SCENES_DIR, 'loading.scene.json'), serializeScene(loading), 'utf8');
    await setLoadingScene(projectPath, loading.id);
    const outputDir = join(projectPath, '..', 'out-loading');

    const result = await exportBuild(projectPath, profile(), outputDir, [templateRoot]);

    const build = await buildOf(outputDir);
    expect(build.loadingScene).toBe(loading.id);
    // Last, so it is never taken for the entry.
    expect(build.scenes.map(({ id }) => id).at(-1)).toBe(loading.id);
    expect(build.scenes[0]!.name).toBe('main');
    expect(result.sceneCount).toBe(2);
    expect((await verifyBuild(outputDir)).ok).toBe(true);
  });

  it('says so when the loading scene is gone, and names none', async () => {
    const { projectPath, templateRoot } = await makeProject();
    await setLoadingScene(projectPath, 'scene-deleted-in-the-finder');
    const outputDir = join(projectPath, '..', 'out-noloading');

    const result = await exportBuild(projectPath, profile(), outputDir, [templateRoot]);

    expect(result.warnings.join(' ')).toMatch(/loading scene \(scene-deleted-in-the-finder\)/);
    expect((await buildOf(outputDir)).loadingScene).toBeNull();
  });

  it('says when a scene holds a component this editor cannot see into', async () => {
    const { projectPath, templateRoot } = await makeProject();
    await addToMainScene(projectPath, { id: 'c1', type: 'plugin.flicker', sprite: 'tex-flame' });
    const outputDir = join(projectPath, '..', 'out-plugin');

    const result = await exportBuild(projectPath, profile(), outputDir, [templateRoot]);

    expect(result.warnings.join(' ')).toMatch(/Scene "main" uses plugin\.flicker/);
  });
});

/*
 * A build is published. The bundle Play compiles carries an inline source map —
 * every script's source, comments and all — and its module comments carried
 * paths from the editor's own working directory, which began with the
 * author's home folder.
 */
describe('what a published script bundle carries', () => {
  it('the code, and neither the sources nor a path off the author\'s disk', async () => {
    const { projectPath, templateRoot } = await makeProject();
    await writeAsset(projectPath, `${ASSETS_DIR}/scripts/Door.ts`, 'script-door', 'script');
    await writeFile(
      join(projectPath, ASSETS_DIR, 'scripts', 'Door.ts'),
      '// a private note\nexport default class Door {}\n',
      'utf8',
    );
    const outputDir = join(projectPath, '..', 'out-bundle');

    await exportBuild(projectPath, profile(), outputDir, [templateRoot]);

    const build = await buildOf(outputDir);
    expect(build.scripts).toMatch(/^scripts\/bundle\.[0-9a-f]{8}\.mjs$/);
    const code = await readFile(inGame(outputDir, build.scripts!), 'utf8');
    expect(code).not.toContain('sourceMappingURL');
    expect(code).not.toContain('a private note');
    // Relative to the project, so it reads as the project does.
    expect(code).toContain('// assets/scripts/Door.ts');
    expect(code).not.toContain(basename(join(projectPath, '..')));

    // Play keeps its map: a breakpoint there lands in the author's own file.
    expect((await buildScripts(projectPath)).code).toContain('sourceMappingURL');
  });
});

describe('a scene whose id is not a name', () => {
  it('ships inside the build all the same, named after the scene', async () => {
    // The id is read off the scene's own file, and it used to be the scene's
    // path in the build: `"id": "../../escaped"` wrote two folders above it.
    // It is only data now; the file is named after the scene and its content.
    const { projectPath, templateRoot } = await makeProject();
    const outputDir = join(projectPath, '..', 'out-evil');
    const main = deserializeScene(
      await readFile(join(projectPath, SCENES_DIR, 'main.scene.json'), 'utf8'),
    );
    const evil = { ...JSON.parse(serializeScene(createStarterScene())), id: '../../escaped' };
    await writeFile(join(projectPath, SCENES_DIR, 'evil.scene.json'), JSON.stringify(evil), 'utf8');

    const result = await exportBuild(
      projectPath,
      profile({ scenes: [main.id, '../../escaped'] }),
      outputDir,
      [templateRoot],
    );

    expect(result.sceneCount).toBe(2);
    const shipped = (await buildOf(outputDir)).scenes[1]!;
    expect(shipped).toMatchObject({ id: '../../escaped', name: 'evil' });
    expect(shipped.path).toMatch(/^scenes\/evil\.[0-9a-f]{8}\.json$/);
    expect(await readdir(join(projectPath, '..'))).not.toContain('escaped.json');
    expect((await verifyBuild(outputDir)).ok).toBe(true);
  });
});

describe('what ships through a link', () => {
  it('ships a symlinked asset as the file it points at', async () => {
    // `cp` copied the link itself: a build holding a pointer into the author's
    // disk, which the host serves as nothing.
    const { projectPath, templateRoot } = await makeProject();
    const library = join(projectPath, '..', 'library');
    await mkdir(library, { recursive: true });
    await writeFile(join(library, 'shared.png'), 'shared pixels', 'utf8');
    const linked = join(projectPath, ASSETS_DIR, 'textures', 'shared.png');
    await symlink(join(library, 'shared.png'), linked);
    await writeFile(
      `${linked}.meta.json`,
      JSON.stringify({
        version: 1,
        id: 'tex-shared',
        kind: 'texture',
        importedAt: 1,
        hash: 'h',
        settings: { kind: 'texture' },
      }),
      'utf8',
    );

    const outputDir = join(projectPath, '..', 'out-link');
    await exportBuild(projectPath, profile({ includeAllAssets: true }), outputDir, [templateRoot]);

    const shipped = inGame(outputDir, (await buildOf(outputDir)).assets['tex-shared']!);
    expect((await lstat(shipped)).isSymbolicLink()).toBe(false);
    expect(await readFile(shipped, 'utf8')).toBe('shared pixels');
  });
});

/*
 * The first thing an author looks at after an export, and the one thing the
 * result could not answer: it counted scenes, assets and scripts, never bytes.
 */
describe('what the build weighs', () => {
  it('puts every file in one row, and the rows add up', async () => {
    const { projectPath, templateRoot } = await makeProject();
    const outputDir = join(projectPath, '..', 'out-size');

    const { size } = await exportBuild(projectPath, profile(), outputDir, [templateRoot]);

    // The page, the bundle and `build.json`: what a build carries whatever is
    // in it.
    expect(size.player).toBeGreaterThan(0);
    expect(size.scenes).toBeGreaterThan(0);
    expect(size.assets.texture).toBeGreaterThan(0);
    expect(size.assets.audio).toBeGreaterThan(0);
    // Nothing shipped of these, and the rows exist anyway: a total record is
    // what makes a kind added to the importers arrive here on its own.
    expect(size.assets.model).toBe(0);
    expect(size.scripts).toBe(0);

    /*
     * The invariant that makes the breakdown worth reading. A set of numbers
     * that nearly adds up sends the reader looking for the rest, so anything a
     * row does not claim falls into `player` rather than into nothing.
     */
    const assets = Object.values(size.assets).reduce((sum, bytes) => sum + bytes, 0);
    expect(size.player + size.scenes + size.scripts + assets).toBe(size.total);

    // And the total is what the list says, since that is where it comes from —
    // minus the list itself, which cannot appear in it.
    const listed = (await listOf(outputDir)).files;
    expect(listed.reduce((sum, file) => sum + file.bytes, 0)).toBe(size.total);
  });
});
