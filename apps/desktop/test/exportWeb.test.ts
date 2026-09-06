import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  ASSETS_DIR,
  BUILD_FORMAT_VERSION,
  PROJECT_FILE_NAME,
  buildScenePath,
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
  type ProjectFile,
  type RenderingSettings,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { readMaterialAssets } from '../src/main/assetLibraries';
import { readAssetMeta, scanAssets } from '../src/main/assetScan';
import { BUILD_FILES_NAME, verifyBuild, type BuildFileList } from '../src/main/buildFiles';
import { exportBuild } from '../src/main/exportWeb';

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
      physics: createPhysicsSettings(),
      build: createBuildProfiles('Export Test'),
    },
  };
  await writeFile(join(projectPath, PROJECT_FILE_NAME), JSON.stringify(project), 'utf8');

  // Stands in for `apps/web-template/dist`, which the exporter copies wholesale.
  const templateRoot = join(root, 'roots');
  const template = join(templateRoot, 'web-template');
  await mkdir(join(template, '_studio'), { recursive: true });
  // Shaped like what Vite emits, not a bare doctype: the base URL is written
  // into `<head>`, and a fixture with no head would pass a test the real
  // template fails.
  await writeFile(join(template, 'index.html'), TEMPLATE_HTML, 'utf8');
  await writeFile(join(template, '_studio', 'player.js'), '// player', 'utf8');

  return { projectPath, templateRoot };
}

const TEMPLATE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <link rel="icon" href="./favicon.svg" />
    <script type="module" crossorigin src="./_studio/player.js"></script>
  </head>
  <body><canvas id="view"></canvas></body>
</html>
`;

const manifestOf = (json: string): BuildManifest => JSON.parse(json) as BuildManifest;

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
    expect(await readdir(join(outputDir, '_studio'))).toContain('player.js');

    // Read once, and against the declaration the exporter writes to: an inline
    // shape here would be a fourth statement of the same manifest.
    const build = JSON.parse(await readFile(join(outputDir, 'build.json'), 'utf8')) as BuildManifest;

    /*
     * The scene, at the path its own id gives — which is the whole of what
     * replaced the map from name to file. Nothing at the root: the entry scene
     * used to be renamed to `scene.json` there while the others went under
     * `scenes/`, and that asymmetry is what this build no longer has.
     */
    const entryId = build.scenes[0]!;
    expect(entryId).toMatch(/\S/);
    expect(await readdir(outputDir)).not.toContain('scene.json');
    const scene = JSON.parse(
      await readFile(join(outputDir, buildScenePath(entryId)), 'utf8'),
    ) as { id: string; entities: Record<string, unknown> };
    expect(scene.id).toBe(entryId);
    expect(Object.keys(scene.entities).length).toBeGreaterThan(0);
    // An alias beside it, so a script naming the level still finds it.
    expect(build.sceneNames?.['main']).toBe(entryId);

    /*
     * Only the referenced texture, and reachable at the path the manifest
     * gives. The name carries eight hex characters of the file's own digest —
     * see `hashedName` — so the assertion is on the shape, and then on the
     * folder holding exactly what the manifest points at.
     */
    const paths = build.assets ?? {};
    expect(paths['tex-used']).toMatch(/^textures\/used\.[0-9a-f]{8}\.png$/);
    // Named by `scene.environment` and by no component. It is also the largest
    // file a scene usually carries, so it is the one whose absence is loudest.
    expect(paths['tex-sky']).toMatch(/^textures\/sky\.[0-9a-f]{8}\.hdr$/);
    expect(paths['tex-spare']).toBeUndefined();
    expect((await readdir(join(outputDir, 'assets', 'textures'))).sort()).toEqual(
      [paths['tex-sky']!, paths['tex-used']!].map((path) => basename(path)).sort(),
    );

    expect(build.title).toBe('Export Test');
    // Named, not probed for: a static server that answers unknown paths with
    // its index page returns 200 and HTML, so asking it whether the bundle
    // exists cannot be answered. This project has no scripts.
    expect(build.scripts).toBeNull();
    expect(await readdir(outputDir)).not.toContain('scripts.mjs');

    // The clip travels like anything else. `collectSceneAssets` reaches it
    // through `componentAssets`, which has followed `audioSource.assetId` since
    // long before anything could play it.
    expect(paths['clip-beep']).toMatch(/^audio\/beep\.[0-9a-f]{8}\.wav$/);

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

    const build = JSON.parse(await readFile(join(outputDir, 'build.json'), 'utf8')) as BuildManifest;
    expect(build.formatVersion).toBe(BUILD_FORMAT_VERSION);
    expect(build.assets?.['tex-used']).toMatch(/^textures\/used\./);
    expect(build.materials?.['mat-shared']).toMatchObject({ color: '#00ff00' });
    // An object rather than absent: the player tells "this build has none" from
    // "this build predates the field", and only one of those needs a fetch.
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
    const before = manifestOf(await readFile(join(outputDir, 'build.json'), 'utf8'));

    await writeFile(texture, 'something else entirely', 'utf8');
    await exportBuild(projectPath, profile(), outputDir, [templateRoot]);
    const after = manifestOf(await readFile(join(outputDir, 'build.json'), 'utf8'));

    expect(after.assets?.['tex-used']).not.toBe(before.assets?.['tex-used']);
    // The one that did not change keeps its name, or the hash would be naming
    // the export rather than the file.
    expect(after.assets?.['tex-sky']).toBe(before.assets?.['tex-sky']);

    // And the folder holds one of it, not two. A hashed copy lands beside its
    // predecessor rather than over it, so without emptying `assets/` first a
    // folder re-exported through a morning of tweaking carries every round.
    const shipped = await readdir(join(outputDir, 'assets', 'textures'));
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

    const build = JSON.parse(await readFile(join(outputDir, 'build.json'), 'utf8')) as {
      assetSettings?: Record<string, Record<string, unknown>>;
    };
    expect(build.assetSettings?.['clip-beep']).toMatchObject({
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

    const build = JSON.parse(await readFile(join(outputDir, 'build.json'), 'utf8')) as {
      forceWebGL: boolean;
      rendering: RenderingSettings;
    };
    expect(build.rendering).toEqual(rendering);
    // Still written beside it: a build is persisted data, and a player that
    // predates `rendering` reads this one.
    expect(build.forceWebGL).toBe(rendering.forceWebGL);
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

    const build = JSON.parse(await readFile(join(outputDir, 'build.json'), 'utf8')) as {
      textureEncodings: Record<string, string>;
    };
    const manifest = await scanAssets(projectPath);
    const gain = manifest.assets.find((asset) => asset.path.endsWith('gain.jpg'))!;
    expect(build.textureEncodings[gain.id]).toBe('ultrahdr');

    // Only the ones that need saying. Radiance and PNG are named by their
    // extension, and listing them would be a second place to keep in step.
    expect(Object.keys(build.textureEncodings)).toEqual([gain.id]);
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
    const shipped = await readdir(join(outputDir, 'assets', 'textures'));
    expect(shipped.map((file) => file.replace(/\.[0-9a-f]{8}\./, '.')).sort()).toEqual([
      'sky.hdr',
      'spare.png',
      'used.png',
    ]);
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
    // And the build is a build: the scene that is left is there, under its own
    // id, and it is the one the manifest names first.
    expect(await readdir(join(outputDir, 'scenes'))).toEqual([`${scene.id}.json`]);
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

    // Byte for byte the template: an empty base is what every build produced
    // before this field existed, and it has to stay that.
    expect(await indexOf(outputDir)).toBe(TEMPLATE_HTML);
  });

  it('treats "." and "./" as no base at all', async () => {
    const { projectPath, templateRoot } = await makeProject();
    for (const [index, basePath] of ['.', './', '  '].entries()) {
      const outputDir = join(projectPath, '..', `out-dot-${index}`);
      await exportBuild(projectPath, profile({ basePath }), outputDir, [templateRoot]);
      // All three resolve against the document, which is what the untagged page
      // already does. A tag saying so would be a difference with no effect.
      expect(await indexOf(outputDir)).toBe(TEMPLATE_HTML);
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
    expect(await indexOf(outputDir)).toBe(TEMPLATE_HTML);
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

    const shipped = join(outputDir, 'assets', 'models', 'Tri');
    expect(await readFile(join(shipped, 'Tri.bin'), 'utf8')).toBe('binary');
    expect(await readFile(join(shipped, 'maps', 'albedo.png'), 'utf8')).toBe('png');
    // A data URI is already inside the file and is not a path to copy.
    expect(result.warnings).toEqual([]);

    /*
     * The companions keep their names and the model does not: the names are
     * written *inside* the `.gltf`, relative to it, so hashing one would break
     * the reference that points at it. Hashing the model alone is safe because
     * it stays in the same directory — which is the whole of what makes those
     * relative URIs still resolve.
     */
    const manifest = manifestOf(await readFile(join(outputDir, 'build.json'), 'utf8'));
    const model = manifest.assets?.['model-tri'];
    expect(model).toMatch(/^models\/Tri\/Tri\.[0-9a-f]{8}\.gltf$/);
    expect(await readdir(shipped)).toContain(basename(model!));
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

    const build = manifestOf(await readFile(join(outputDir, 'build.json'), 'utf8'));
    const listed = (await listOf(outputDir)).files;
    const paths = listed.map((file) => file.path);

    // The player arrives by copying a directory, so the exporter never names
    // its files one by one — which is why the list is a walk of the folder.
    expect(paths).toContain('index.html');
    expect(paths).toContain('_studio/player.js');
    expect(paths).toContain(buildScenePath(build.scenes[0]!));
    expect(paths).toContain(`assets/${build.assets!['tex-used']!}`);
    // Itself included, and that is what a file of its own buys: a manifest
    // cannot carry its own digest, so `build.json` could not be checked while
    // this list lived inside it.
    expect(paths).toContain('build.json');
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

    const manifest = join(outputDir, 'build.json');
    const build = manifestOf(await readFile(manifest, 'utf8'));
    await writeFile(manifest, JSON.stringify({ ...build, title: 'Something Else' }), 'utf8');

    expect((await verifyBuild(outputDir)).changed).toEqual(['build.json']);
  });

  it('names what has gone missing and what has appeared', async () => {
    const { projectPath, templateRoot } = await makeProject();
    const outputDir = join(projectPath, '..', 'out-moved');
    await exportBuild(projectPath, profile(), outputDir, [templateRoot]);

    await rm(join(outputDir, '_studio', 'player.js'));
    await writeFile(join(outputDir, 'analytics.js'), 'fetch("//elsewhere")', 'utf8');

    const verified = await verifyBuild(outputDir);
    expect(verified.missing).toEqual(['_studio/player.js']);
    // Neither missing nor altered, and reported anyway: a file that appeared
    // after the export is what an injected one looks like.
    expect(verified.unexpected).toEqual(['analytics.js']);
  });

  it('takes back a scene it no longer ships, so the list describes this export', async () => {
    /*
     * The counterpart of emptying `assets/`, and the reason it is here rather
     * than with the scene layout that introduced it: a walk of the folder
     * cannot tell what this export wrote from what the last one left, so
     * anything stale would be listed — and verification would then bless a
     * folder holding two exports at once.
     */
    const { projectPath, templateRoot } = await makeProject();
    const outputDir = join(projectPath, '..', 'out-stale');
    await exportBuild(projectPath, profile(), outputDir, [templateRoot]);

    // What a scene deleted or renamed in the project leaves behind.
    await writeFile(join(outputDir, 'scenes', 'a-scene-since-deleted.json'), '{}', 'utf8');
    await exportBuild(projectPath, profile(), outputDir, [templateRoot]);

    expect(await readdir(join(outputDir, 'scenes'))).not.toContain('a-scene-since-deleted.json');
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
