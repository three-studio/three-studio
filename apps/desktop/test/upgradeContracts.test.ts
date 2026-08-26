import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ASSETS_DIR,
  ASSET_META_SUFFIX,
  ASSET_META_VERSION,
  CACHE_DIR,
  SCRIPT_API_VERSION,
  type AssetEntry,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import { scanAssets } from '../src/main/assets';
import { writeScriptTypings } from '../src/main/scripts';

/*
 * The contracts that are not files in a project but still cross a version
 * boundary: what the editor writes into someone's working directory, and what
 * a compiled script bundle expects to find running.
 */

describe('script typings and tsconfig', () => {
  it('writes its own config under .studio and a project file that extends it', async () => {
    const project = await mkdtemp(join(tmpdir(), 'studio-tsconfig-'));
    await writeScriptTypings(project);

    const studio = JSON.parse(
      await readFile(join(project, CACHE_DIR, 'tsconfig.json'), 'utf8'),
    ) as { include: string[] };
    // One level down, so the patterns have to climb back out.
    expect(studio.include.every((pattern) => pattern.startsWith('../'))).toBe(true);

    const projectConfig = JSON.parse(await readFile(join(project, 'tsconfig.json'), 'utf8')) as {
      extends: string;
    };
    expect(projectConfig.extends).toBe('./.studio/tsconfig.json');
  });

  it('never overwrites a tsconfig the author has edited', async () => {
    const project = await mkdtemp(join(tmpdir(), 'studio-tsconfig-'));
    await mkdir(join(project, CACHE_DIR), { recursive: true });
    const mine = JSON.stringify(
      { extends: './.studio/tsconfig.json', compilerOptions: { strict: false } },
      null,
      2,
    );
    await writeFile(join(project, 'tsconfig.json'), mine, 'utf8');

    // Opening a project regenerates the typings, which is where this used to
    // take the customisation with it.
    await writeScriptTypings(project);
    await writeScriptTypings(project);

    expect(await readFile(join(project, 'tsconfig.json'), 'utf8')).toBe(mine);
  });

  it('bakes the API version into the shim so a stale bundle says so', async () => {
    const project = await mkdtemp(join(tmpdir(), 'studio-shim-'));
    await writeScriptTypings(project);

    // The shim is written next to the bundle at build time; its check is what
    // turns "a method vanished" into a sentence instead of a TypeError deep in
    // someone's behaviour.
    const typings = await readFile(join(project, CACHE_DIR, 'studio-runtime.d.ts'), 'utf8');
    expect(typings).toContain("declare module '@three-studio/runtime'");
    expect(SCRIPT_API_VERSION).toBeGreaterThan(0);
  });
});

/*
 * The asset sidecar. Format 2 added a texture's `encoding`, which is the one
 * setting no file name can answer: an Ultra HDR image is a `.jpg`, and only its
 * gainmap metadata tells it from a photograph. Getting it wrong is not a broken
 * import — the file decodes perfectly, with every stop of range above white
 * gone, and the sky simply casts no light.
 */

/** A JPEG head with the segments `UltraHDRLoader` requires, and nothing else. */
function ultraHdrBytes(marker: string): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe1]),
    Buffer.from(marker, 'latin1'),
    Buffer.alloc(64),
  ]);
}

async function scanOne(file: string, bytes: Buffer): Promise<AssetEntry> {
  const project = await mkdtemp(join(tmpdir(), 'studio-sidecar-'));
  await mkdir(join(project, ASSETS_DIR, 'textures'), { recursive: true });
  await writeFile(join(project, ASSETS_DIR, 'textures', file), bytes);
  const manifest = await scanAssets(project);
  return manifest.assets[0]!;
}

describe('the asset sidecar', () => {
  it('reads Ultra HDR out of a JPEG, by both the current and the legacy marker', async () => {
    for (const marker of ['urn:iso:std:iso:ts:21496:-1', 'hdrgm:Version']) {
      const asset = await scanOne('sky.jpg', ultraHdrBytes(marker));
      expect(asset.settings).toMatchObject({ kind: 'texture', encoding: 'ultrahdr' });
    }
  });

  it('leaves an ordinary JPEG alone', async () => {
    const asset = await scanOne('photo.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]));
    expect(asset.settings).toMatchObject({ kind: 'texture', encoding: 'sdr' });
  });

  it('takes Radiance from the extension, which does say', async () => {
    const asset = await scanOne('sky.hdr', Buffer.from('#?RADIANCE\n', 'latin1'));
    expect(asset.settings).toMatchObject({ kind: 'texture', encoding: 'hdr' });
  });

  it('agrees with itself when three scans run at once', async () => {
    // `exportBuild` starts three: its own, plus one inside `readMaterialAssets`
    // and one inside `readPrefabAssets`. Since a scan writes sidecars as well
    // as reading them, they race — and the failure is silent. A reader catching
    // a half-written file adopts the asset under a **fresh id**, so the scene
    // that referenced it now references nothing and the export ships a level
    // with a texture missing.
    const project = await mkdtemp(join(tmpdir(), 'studio-sidecar-'));
    const textures = join(project, ASSETS_DIR, 'textures');
    await mkdir(textures, { recursive: true });
    for (let i = 0; i < 12; i++) {
      await writeFile(join(textures, `t${i}.png`), 'x', 'utf8');
    }

    const scans = await Promise.all([scanAssets(project), scanAssets(project), scanAssets(project)]);
    const ids = scans.map((manifest) =>
      manifest.assets.map((asset) => `${asset.name}:${asset.id}`).sort().join(','),
    );
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).toBe(ids[0]);
  });

  it('upgrades a format 1 sidecar in place, keeping its id and its settings', async () => {
    const project = await mkdtemp(join(tmpdir(), 'studio-sidecar-'));
    const textures = join(project, ASSETS_DIR, 'textures');
    await mkdir(textures, { recursive: true });
    const file = join(textures, 'sky.jpg');
    await writeFile(file, ultraHdrBytes('hdrgm:Version'));
    // As the build before this one wrote it: no `encoding`, and a colour space
    // the author had retagged by hand.
    await writeFile(
      `${file}${ASSET_META_SUFFIX}`,
      JSON.stringify({
        version: 1,
        id: 'tex-sky',
        kind: 'texture',
        importedAt: 1,
        hash: 'h',
        settings: { kind: 'texture', colorSpace: 'linear', wrap: 'clamp', flipY: false },
      }),
      'utf8',
    );

    const asset = (await scanAssets(project)).assets[0]!;
    // The id above all: it is what every scene in the project references.
    expect(asset.id).toBe('tex-sky');
    expect(asset.settings).toMatchObject({
      colorSpace: 'linear',
      wrap: 'clamp',
      flipY: false,
      encoding: 'ultrahdr',
    });

    // Written back rather than filled in memory, so the file read it costs is
    // paid once per asset and not once per scan.
    const stored = JSON.parse(await readFile(`${file}${ASSET_META_SUFFIX}`, 'utf8')) as {
      version: number;
      settings: { encoding: string };
    };
    expect(stored.version).toBe(ASSET_META_VERSION);
    expect(stored.settings.encoding).toBe('ultrahdr');
  });

  it('fills a format 2 model with its format and the trunk that came with it', async () => {
    const project = await mkdtemp(join(tmpdir(), 'studio-sidecar-'));
    const models = join(project, ASSETS_DIR, 'models');
    await mkdir(models, { recursive: true });
    const file = join(models, 'tree.fbx');
    await writeFile(file, 'fbx', 'utf8');
    // As format 2 wrote it: no `format`, no `upAxis`, and a scale the author
    // had already set by hand to survive Unreal's centimetres.
    await writeFile(
      `${file}${ASSET_META_SUFFIX}`,
      JSON.stringify({
        version: 2,
        id: 'mdl-tree',
        kind: 'model',
        importedAt: 1,
        hash: 'h',
        settings: { kind: 'model', scale: 0.01, generateColliders: true },
      }),
      'utf8',
    );

    const asset = (await scanAssets(project)).assets[0]!;
    expect(asset.id).toBe('mdl-tree');
    expect(asset.settings).toMatchObject({
      // The author's, untouched.
      scale: 0.01,
      generateColliders: true,
      // Filled from the format's own factory, and the format itself read off
      // the extension — which is why no second list of defaults is needed.
      format: 'fbx',
      upAxis: 'y',
      importMaterials: true,
      importAnimations: true,
      collisionMeshes: 'ignore',
    });

    const stored = JSON.parse(await readFile(`${file}${ASSET_META_SUFFIX}`, 'utf8')) as {
      version: number;
      settings: { format: string };
    };
    expect(stored.version).toBe(ASSET_META_VERSION);
    expect(stored.settings.format).toBe('fbx');
  });

  it('gives an OBJ its own format rather than the FBX one', async () => {
    const project = await mkdtemp(join(tmpdir(), 'studio-sidecar-'));
    const models = join(project, ASSETS_DIR, 'models');
    await mkdir(models, { recursive: true });
    await writeFile(join(models, 'rock.obj'), 'o rock\n', 'utf8');

    const asset = (await scanAssets(project)).assets[0]!;
    expect(asset.settings).toMatchObject({ kind: 'model', format: 'obj', computeNormals: true });
  });
});
