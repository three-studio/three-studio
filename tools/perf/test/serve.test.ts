import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contentType, serveFolder, type StaticServer } from '../launch/serve';

/*
 * The server an exported build is opened from. Its two duties are the types —
 * a `.wasm` served as anything but `application/wasm` cannot be compiled while
 * it streams, and Rapier and meshopt are WebAssembly — and staying inside the
 * folder it was given.
 */

describe('the content types', () => {
  it('names what an exported build holds', () => {
    expect(contentType('index.html')).toBe('text/html; charset=utf-8');
    expect(contentType('player/main-1a2b.js')).toBe('text/javascript; charset=utf-8');
    expect(contentType('player/rapier.wasm')).toBe('application/wasm');
    expect(contentType('game/build.json')).toBe('application/json; charset=utf-8');
    expect(contentType('game/assets/a.glb')).toBe('model/gltf-binary');
    expect(contentType('favicon.svg')).toBe('image/svg+xml');
    expect(contentType('game/assets/t.PNG')).toBe('image/png');
  });

  it('falls back to bytes for what it does not know', () => {
    expect(contentType('game/assets/clip.unknown')).toBe('application/octet-stream');
  });
});

describe('the server', () => {
  let root = '';
  let server: StaticServer | null = null;
  beforeAll(async () => {
    const parent = await mkdtemp(join(tmpdir(), 'perf-serve-'));
    root = join(parent, 'build');
    await mkdir(join(root, 'player'), { recursive: true });
    await writeFile(join(root, 'index.html'), '<!doctype html><title>t</title>');
    await writeFile(join(root, 'player', 'main.js'), 'export {};');
    await writeFile(join(parent, 'secret.txt'), 'outside');
    server = await serveFolder(root);
  });
  afterAll(async () => {
    await server?.close();
    await rm(join(root, '..'), { recursive: true, force: true });
  });

  it('serves a file of the folder with its type', async () => {
    const response = await fetch(`${server?.url}player/main.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(await response.text()).toBe('export {};');
  });

  it('serves the page for the folder itself', async () => {
    const response = await fetch(`${server?.url}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<title>t</title>');
  });

  it('refuses a path that climbs out of the folder', async () => {
    // The slash encoded, so that neither `fetch` nor the URL parser folds the
    // `..` away before it arrives: decoded, it names `../secret.txt`.
    const response = await fetch(`${server?.url}..%2fsecret.txt`);
    expect(response.status).toBe(404);
  });

  it('answers 404 for a file that is not there', async () => {
    expect((await fetch(`${server?.url}nothing.js`)).status).toBe(404);
  });
});
