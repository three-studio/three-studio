import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { request as httpRequest, createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ASSETS_DIR,
  CACHE_DIR,
  LAUNCH_SNAPSHOT_VERSION,
  SCENES_DIR,
  createEmptyScene,
  createMeshEntity,
  deserializeScene,
  insertEntity,
  serializeScene,
  type LaunchSnapshot,
} from '@three-studio/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { scanAssets } from '../src/main/assetScan';
import { isOwnHost } from '../src/main/devices/addresses';
import { prepareLaunch, type Launch } from '../src/main/devices/launch';
import { createDeviceHandler } from '../src/main/devices/routes';
import { WAITING_PAGE } from '../src/main/devices/waitingPage';
import { createProject, discoverScenes, readProject } from '../src/main/project';

/*
 * The routes, over a real socket: what a phone asks for, and what it is
 * answered — from the launch in memory, from the project's files by id, and
 * from the prebuilt player. Requests go through `node:http` rather than
 * `fetch`, which would not let a test choose the `Host` it sends.
 */

const TOKEN = 'abcdefghijKLMNOPQRST01';
const TEMPLATE_HTML = '<!doctype html><html><head></head><body>player</body></html>';

let server: Server;
let port = 0;
let root = '';
let templateDir = '';
let launch: Launch;
let current: Launch | null = null;
let entryId = '';
let otherSceneJson = '';
let slashedId = '';
let modelId = '';
let objId = '';
let scriptId = '';

interface Answer {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

function ask(
  path: string,
  options: { method?: string; headers?: Record<string, string> } = {},
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const sent = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method: options.method ?? 'GET',
        headers: { host: `127.0.0.1:${port}`, ...options.headers },
        agent: false,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    sent.on('error', reject);
    sent.end();
  });
}

const under = (path: string): string => `/${TOKEN}/${path}`;

async function writeAsset(path: string, id: string, kind: string, contents: string): Promise<void> {
  const file = join(root, path);
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, contents, 'utf8');
  await writeFile(
    `${file}.meta.json`,
    JSON.stringify({ version: 1, id, kind, importedAt: 1, hash: 'h', settings: { kind } }),
    'utf8',
  );
}

beforeAll(async () => {
  const parent = await mkdtemp(join(tmpdir(), 'studio-routes-'));
  root = (await createProject('Races', parent)).summary.path;
  // The project's one scene, before the others below join it.
  const [main] = await discoverScenes(root);

  await writeAsset(`${ASSETS_DIR}/textures/brick.png`, 'tex-brick', 'texture', 'source bytes');

  // A glTF naming its buffer and an image one folder down, with a space in it,
  // and a file beside it that it does not name.
  const models = join(root, ASSETS_DIR, 'models');
  await mkdir(join(models, 'textures'), { recursive: true });
  await writeFile(join(models, 'Tri.bin'), 'buffer bytes', 'utf8');
  await writeFile(join(models, 'textures', 'Tri Color.png'), 'image bytes', 'utf8');
  await writeFile(join(models, 'Secret.txt'), 'not named', 'utf8');
  await writeFile(
    join(models, 'Tri.gltf'),
    JSON.stringify({
      asset: { version: '2.0' },
      buffers: [{ uri: 'Tri.bin' }],
      images: [{ uri: 'textures/Tri%20Color.png' }],
    }),
    'utf8',
  );
  // An OBJ, whose material library names its map.
  await mkdir(join(models, 'mats'), { recursive: true });
  await writeFile(join(models, 'mats', 'Crate.mtl'), 'newmtl Crate\nmap_Kd wood.png\n', 'utf8');
  await writeFile(join(models, 'mats', 'wood.png'), 'wood bytes', 'utf8');
  await writeFile(join(models, 'Crate.obj'), 'mtllib mats/Crate.mtl\nv 0 0 0\n', 'utf8');

  await mkdir(join(root, ASSETS_DIR, 'scripts'), { recursive: true });
  await writeFile(
    join(root, ASSETS_DIR, 'scripts', 'Spin.ts'),
    `import { Behaviour } from '@three-studio/runtime';\nexport default class Spin extends Behaviour {}\n`,
    'utf8',
  );

  // A second scene, and a hand-written one with no id, which is then
  // addressed by its path: an id holding slashes.
  const other = createEmptyScene();
  otherSceneJson = `${serializeScene(other)}\n`;
  await writeFile(join(root, SCENES_DIR, 'Other.scene.json'), otherSceneJson, 'utf8');
  await mkdir(join(root, SCENES_DIR, 'levels'), { recursive: true });
  const withoutId = JSON.parse(serializeScene(createEmptyScene())) as Record<string, unknown>;
  delete withoutId['id'];
  await writeFile(join(root, SCENES_DIR, 'levels', 'Two.scene.json'), JSON.stringify(withoutId), 'utf8');

  const scenes = await discoverScenes(root);
  entryId = main!.id;
  slashedId = scenes.find((scene) => scene.path.endsWith('Two.scene.json'))!.id;
  const scene = deserializeScene(await readFile(join(root, main!.path), 'utf8'));
  const crate = createMeshEntity('box');
  crate.entity.name = 'Unsaved Crate';
  insertEntity(scene, crate);
  const { settings } = await readProject(root);
  const snapshot: LaunchSnapshot = {
    version: LAUNCH_SNAPSHOT_VERSION,
    entry: { id: main!.id, name: main!.name, scene },
    materials: {},
    prefabs: {},
    rendering: settings.rendering,
    physics: settings.physics,
    loadingScene: null,
  };
  const prepared = await prepareLaunch(root, snapshot);

  // A scaled copy, given by hand: what a device should download in place of
  // the source, under the source's name.
  const copy = `${CACHE_DIR}/imported/tex-brick/copy.png`;
  await mkdir(join(root, CACHE_DIR, 'imported', 'tex-brick'), { recursive: true });
  await writeFile(join(root, copy), 'scaled bytes', 'utf8');
  const assets = new Map(prepared.assets);
  assets.set('tex-brick', { ...assets.get('tex-brick')!, importedPath: copy });
  launch = { ...prepared, assets };
  modelId = [...assets.values()].find((asset) => asset.path.endsWith('Tri.gltf'))!.id;
  objId = [...assets.values()].find((asset) => asset.path.endsWith('Crate.obj'))!.id;
  scriptId = (await scanAssets(root)).assets.find((asset) => asset.kind === 'script')!.id;

  templateDir = join(parent, 'web-template');
  await mkdir(join(templateDir, '_studio'), { recursive: true });
  await writeFile(join(templateDir, 'index.html'), TEMPLATE_HTML, 'utf8');
  await writeFile(join(templateDir, '_studio', 'player.js'), '// player', 'utf8');
  await writeFile(join(templateDir, 'favicon.svg'), '<svg/>', 'utf8');

  server = createServer(
    createDeviceHandler({
      token: TOKEN,
      templateDir,
      launch: () => current,
      isOwnHost: (host) => isOwnHost(host, [], 'Mac'),
      onRequest: () => undefined,
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  current = launch;
});

describe('the token', () => {
  it('answers nothing at the root, and nothing to a wrong token', async () => {
    expect((await ask('/')).status).toBe(404);
    const wrong = await ask('/abcdefghijKLMNOPQRST02/');
    expect(wrong.status).toBe(404);
    expect(wrong.body.toString()).not.toContain(TOKEN);
    expect(wrong.body.toString()).toBe('Not found');
  });

  it('adds the slash a URL typed by hand leaves off', async () => {
    const answer = await ask(`/${TOKEN}`);

    expect(answer.status).toBe(308);
    expect(answer.headers.location).toBe(`/${TOKEN}/`);
  });
});

describe('the page', () => {
  it('is the waiting page before anything is launched', async () => {
    current = null;

    const page = await ask(under(''));

    expect(page.status).toBe(200);
    expect(page.body.toString()).toBe(WAITING_PAGE);
    expect(page.headers['cache-control']).toBe('no-store');
    expect((await ask(under('build.json'))).status).toBe(404);
    expect((await ask(under('scripts.mjs'))).status).toBe(404);
  });

  it('is the player once a launch is current', async () => {
    const page = await ask(under(''));

    expect(page.status).toBe(200);
    expect(page.body.toString()).toBe(TEMPLATE_HTML);
    expect(page.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(page.headers['cache-control']).toBe('no-store');
  });
});

describe('build.json', () => {
  it('is the launch’s manifest, never kept', async () => {
    const answer = await ask(under('build.json'));

    expect(answer.status).toBe(200);
    expect(answer.body.toString()).toBe(launch.manifestJson);
    expect(answer.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(answer.headers['cache-control']).toBe('no-store');
  });

  it('gives its length to HEAD, and no body', async () => {
    const answer = await ask(under('build.json'), { method: 'HEAD' });

    expect(answer.status).toBe(200);
    expect(answer.headers['content-length']).toBe(String(Buffer.byteLength(launch.manifestJson)));
    expect(answer.body.length).toBe(0);
  });
});

describe('the scenes', () => {
  it('answers the entry from the editor’s memory, with what the file lacks', async () => {
    const answer = await ask(under(`scenes/${encodeURIComponent(entryId)}.json`));

    expect(answer.status).toBe(200);
    expect(answer.body.toString()).toBe(launch.entryJson);
    expect(answer.body.toString()).toContain('Unsaved Crate');
    expect(answer.headers['cache-control']).toBe('no-store');
  });

  it('answers another scene with its file, byte for byte', async () => {
    const other = (await discoverScenes(root)).find((scene) => scene.path.endsWith('Other.scene.json'))!;

    const answer = await ask(under(`scenes/${encodeURIComponent(other.id)}.json`));

    expect(answer.status).toBe(200);
    expect(answer.body.toString()).toBe(otherSceneJson);
  });

  it('finds an id that holds slashes, one segment at a time', async () => {
    const path = slashedId.split('/').map(encodeURIComponent).join('/');

    const answer = await ask(under(`scenes/${path}.json`));

    expect(slashedId).toContain('/');
    expect(answer.status).toBe(200);
  });

  it('answers 404 for a scene the project does not have', async () => {
    expect((await ask(under('scenes/nobody.json'))).status).toBe(404);
  });
});

describe('the assets', () => {
  it('serves the scaled copy under the source’s name, kept with an ETag', async () => {
    const answer = await ask(under('assets/tex-brick/brick.png'));

    expect(answer.status).toBe(200);
    expect(answer.body.toString()).toBe('scaled bytes');
    expect(answer.headers['content-type']).toBe('image/png');
    expect(answer.headers['cache-control']).toBe('no-cache');
    expect(answer.headers.etag).toMatch(/^W\/"/);
  });

  it('answers 304 with no body when the device’s copy is current', async () => {
    const first = await ask(under('assets/tex-brick/brick.png'));

    const again = await ask(under('assets/tex-brick/brick.png'), {
      headers: { 'if-none-match': String(first.headers.etag) },
    });

    expect(again.status).toBe(304);
    expect(again.body.length).toBe(0);
  });

  it('serves the source when there is no copy', async () => {
    const answer = await ask(under(`assets/${modelId}/Tri.gltf`));

    expect(answer.status).toBe(200);
    expect(answer.headers['content-type']).toBe('model/gltf+json');
    expect(answer.body.toString()).toContain('Tri.bin');
  });

  it('answers 404 for a wrong name, an unknown id, and a script', async () => {
    expect((await ask(under('assets/tex-brick/stone.png'))).status).toBe(404);
    expect((await ask(under('assets/nobody/brick.png'))).status).toBe(404);
    expect((await ask(under(`assets/${scriptId}/Spin.ts`))).status).toBe(404);
  });
});

describe('a model’s side files', () => {
  it('serves what the glTF names, beside it', async () => {
    const buffer = await ask(under(`assets/${modelId}/Tri.bin`));
    const image = await ask(under(`assets/${modelId}/textures/Tri%20Color.png`));

    expect(buffer.status).toBe(200);
    expect(buffer.body.toString()).toBe('buffer bytes');
    expect(image.status).toBe(200);
    expect(image.body.toString()).toBe('image bytes');
  });

  it('answers 404 for a file it does not name, and for a way out', async () => {
    expect((await ask(under(`assets/${modelId}/Secret.txt`))).status).toBe(404);
    expect((await ask(under(`assets/${modelId}/%2e%2e/models/Tri.bin`))).status).toBe(404);
    expect((await ask(under(`assets/${modelId}/%2e%2e%2fSecret.txt`))).status).toBe(404);
  });

  it('serves the OBJ’s material library and its map', async () => {
    const library = await ask(under(`assets/${objId}/mats/Crate.mtl`));
    const map = await ask(under(`assets/${objId}/mats/wood.png`));

    expect(library.status).toBe(200);
    expect(library.body.toString()).toContain('newmtl Crate');
    expect(map.status).toBe(200);
  });
});

describe('the script bundle', () => {
  it('is the launch’s, never kept', async () => {
    const answer = await ask(under('scripts.mjs'));

    expect(answer.status).toBe(200);
    expect(answer.body.toString()).toBe(launch.scripts);
    expect(answer.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(answer.headers['cache-control']).toBe('no-store');
  });

  it('is not there for a launch without scripts', async () => {
    current = { ...launch, scripts: null };

    expect((await ask(under('scripts.mjs'))).status).toBe(404);
  });
});

describe('the player', () => {
  it('serves its bundle as immutable, and nothing outside it', async () => {
    const bundle = await ask(under('_studio/player.js'));

    expect(bundle.status).toBe(200);
    expect(bundle.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await ask(under('_studio/%2e%2e/index.html'))).status).toBe(404);
  });

  it('serves its icon', async () => {
    const icon = await ask(under('favicon.svg'));

    expect(icon.status).toBe(200);
    expect(icon.headers['content-type']).toBe('image/svg+xml');
    expect(icon.headers.etag).toMatch(/^W\/"/);
  });
});

describe('what is refused', () => {
  it('answers 403 to a Host this machine does not go by', async () => {
    const answer = await ask(under(''), { headers: { host: 'evil.example' } });

    expect(answer.status).toBe(403);
    expect(answer.body.toString()).toBe('Unknown host name');
    expect((await ask(under(''), { headers: { host: `localhost:${port}` } })).status).toBe(200);
  });

  it('answers 404 to anything but GET and HEAD, and to what is reserved', async () => {
    expect((await ask(under('build.json'), { method: 'POST' })).status).toBe(404);
    expect((await ask(under('__studio/x'))).status).toBe(404);
    expect((await ask(under('elsewhere.json'))).status).toBe(404);
  });

  it('says where to send no Referer, and not to sniff, on every answer', async () => {
    const answers = await Promise.all([
      ask(under('')),
      ask(under('build.json')),
      ask(under('assets/tex-brick/brick.png')),
      ask(under('_studio/player.js')),
      ask(`/${TOKEN}`),
      ask('/nothing/'),
      ask(under(''), { headers: { host: 'evil.example' } }),
    ]);

    for (const answer of answers) {
      expect(answer.headers['referrer-policy']).toBe('no-referrer');
      expect(answer.headers['x-content-type-options']).toBe('nosniff');
    }
  });
});
