import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ASSETS_DIR,
  PROJECT_FILE_NAME,
  PROJECT_FORMAT_VERSION,
  SCENES_DIR,
  createBuildProfiles,
  createComponent,
  createMaterial,
  createMeshEntity,
  createAudioSourceEntity,
  createStarterScene,
  deserializeScene,
  insertEntity,
  putComponent,
  serializeScene,
  type BuildProfile,
  type MeshComponent,
  type ProjectFile,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { readAssetMeta, readMaterialAssets, scanAssets } from '../src/main/assets';
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
async function makeProject(): Promise<{ projectPath: string; templateRoot: string }> {
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
    scenes: [{ id: scene.id, name: 'main', path: `${SCENES_DIR}/main.scene.json` }],
    startScene: scene.id,
    settings: { build: createBuildProfiles('Export Test') },
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

    // The scene, parseable, with the entity that was added.
    const scene = JSON.parse(await readFile(join(outputDir, 'scene.json'), 'utf8')) as {
      entities: Record<string, unknown>;
    };
    expect(Object.keys(scene.entities).length).toBeGreaterThan(0);

    // Only the referenced texture, and reachable at the path the manifest gives.
    const paths = JSON.parse(await readFile(join(outputDir, 'assets.json'), 'utf8')) as Record<
      string,
      string
    >;
    expect(paths['tex-used']).toBe('textures/used.png');
    // Named by `scene.environment` and by no component. It is also the largest
    // file a scene usually carries, so it is the one whose absence is loudest.
    expect(paths['tex-sky']).toBe('textures/sky.hdr');
    expect(paths['tex-spare']).toBeUndefined();
    expect((await readdir(join(outputDir, 'assets', 'textures'))).sort()).toEqual([
      'sky.hdr',
      'used.png',
    ]);

    const build = JSON.parse(await readFile(join(outputDir, 'build.json'), 'utf8')) as {
      title: string;
      scenes: string[];
      scripts: string | null;
    };
    expect(build.title).toBe('Export Test');
    expect(build.scenes).toEqual(['scene.json']);
    // Named, not probed for: a static server that answers unknown paths with
    // its index page returns 200 and HTML, so asking it whether the bundle
    // exists cannot be answered. This project has no scripts.
    expect(build.scripts).toBeNull();
    expect(await readdir(outputDir)).not.toContain('scripts.mjs');

    // The clip travels like anything else. `collectSceneAssets` reaches it
    // through `componentAssets`, which has followed `audioSource.assetId` since
    // long before anything could play it.
    expect(paths['clip-beep']).toBe('audio/beep.wav');

    // Three, not four: the spare texture is not referenced. And three rather
    // than one is the whole point — the sky counts, and so does the sound.
    expect(result).toMatchObject({ sceneCount: 1, assetCount: 3, warnings: [] });
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
    expect((await readdir(join(outputDir, 'assets', 'textures'))).sort()).toEqual([
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
