import { assertDefined, fixedId, type AssetId } from '@three-studio/core';
import { Mesh, MeshStandardMaterial, type BufferGeometry, type Object3D, type Texture } from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetCache } from '../src/assets/AssetCache';
import { serveModels, stubImages, type ModelServer } from './assetFixtures';
import { builtInRegistries } from './registries';

const registries = builtInRegistries();

/*
 * The project's one cache of loaded files, with three's own loaders: a glTF
 * over HTTP, and images through a stand-in for the browser's decoder.
 *
 * What it settles is ownership. Before it, each scene's cache kept every model
 * it ever loaded, Play parsed a second copy of each, and nothing freed a model's
 * textures at all — `Material.dispose` frees none, by three's own rule. Now a
 * holder takes a hold and gives it back, and the cache alone decides what to
 * free, and when.
 */

const CRATE = fixedId('asset', 'crate');
const BARREL = fixedId('asset', 'barrel');
const BRICKS = fixedId('asset', 'bricks');
const MUSIC = fixedId('asset', 'music');

/** The editor's budget: far more than a triangle. */
const ROOMY = 256 * 1024 * 1024;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A cache over two models on the server, an image and a sound, keeping this many idle bytes. */
function cacheOver(server: ModelServer | null, idleBudgetBytes: number): AssetCache {
  const urls = new Map<AssetId, string>([
    [BRICKS, 'http://127.0.0.1/bricks.png'],
    [MUSIC, 'http://127.0.0.1/music.ogg'],
  ]);
  if (server !== null) {
    urls.set(CRATE, server.url('crate.gltf'));
    urls.set(BARREL, server.url('barrel.gltf'));
  }
  return new AssetCache(registries, { resolver: { url: (id) => urls.get(id) ?? null }, idleBudgetBytes });
}

interface Parts {
  readonly geometry: BufferGeometry;
  readonly material: MeshStandardMaterial;
  readonly texture: Texture;
}

/** What a placement of the triangle draws with: the master's own, shared by every clone. */
function partsOf(object: Object3D | null): Parts {
  const meshes: Mesh[] = [];
  object?.traverse((child) => {
    if (child instanceof Mesh) meshes.push(child);
  });
  const { geometry, material } = assertDefined(meshes[0], 'the triangle');
  if (!(material instanceof MeshStandardMaterial)) throw new Error('the triangle draws no standard material');
  return { geometry, material, texture: assertDefined(material.map, "the triangle's image") };
}

/** How many times each part has been freed, read when asked. */
function freedOf(parts: Parts): () => { geometry: number; material: number; texture: number } {
  const counts = { geometry: 0, material: 0, texture: 0 };
  parts.geometry.addEventListener('dispose', () => void (counts.geometry += 1));
  parts.material.addEventListener('dispose', () => void (counts.material += 1));
  parts.texture.addEventListener('dispose', () => void (counts.texture += 1));
  return () => ({ ...counts });
}

const NOTHING_FREED = { geometry: 0, material: 0, texture: 0 };
const ALL_FREED = { geometry: 1, material: 1, texture: 1 };

describe('a model', () => {
  it('is fetched once for two holds, each a clone of its own drawing the same geometry', async () => {
    stubImages();
    const server = await serveModels();
    const cache = cacheOver(server, ROOMY);

    const first = cache.holdModel(CRATE, null);
    const second = cache.holdModel(CRATE, null);
    const [a, b] = await Promise.all([first.object, second.object]);

    expect(server.requests('crate.gltf')).toBe(1);
    // Two placements are two objects, each moved on its own …
    expect(a).not.toBe(b);
    // … and one model on the GPU.
    expect(partsOf(a).geometry).toBe(partsOf(b).geometry);
    expect(cache.stats).toEqual({ entries: 1, held: 2, idleBytes: 0 });
  });

  it('stays after its last hold while it fits the budget, and comes back without a load', async () => {
    stubImages();
    const server = await serveModels();
    const cache = cacheOver(server, ROOMY);

    const first = cache.holdModel(CRATE, null);
    await first.object;
    first.dispose();
    expect(cache.stats.held).toBe(0);
    expect(cache.stats.idleBytes).toBeGreaterThan(0);

    // What an undo of a delete does: the model is still there.
    await cache.holdModel(CRATE, null).object;
    expect(server.requests('crate.gltf')).toBe(1);
    expect(cache.stats).toEqual({ entries: 1, held: 1, idleBytes: 0 });
  });

  it('goes oldest first past the budget, and is freed, textures included, at the next frame', async () => {
    stubImages();
    const server = await serveModels();
    const cache = cacheOver(server, ROOMY);

    const crate = cache.holdModel(CRATE, null);
    const crateFreed = freedOf(partsOf(await crate.object));
    crate.dispose();
    const oneModel = cache.stats.idleBytes;

    const barrel = cache.holdModel(BARREL, null);
    const barrelFreed = freedOf(partsOf(await barrel.object));
    barrel.dispose();
    expect(cache.stats.idleBytes).toBe(2 * oneModel);

    // A lower budget evicts at once, the oldest release first …
    cache.setIdleBudgetBytes(1.5 * oneModel);
    expect(cache.stats).toEqual({ entries: 1, held: 0, idleBytes: oneModel });
    // … and frees nothing yet: the frame in flight may still be drawing it.
    expect(crateFreed()).toEqual(NOTHING_FREED);
    cache.beginFrame();
    expect(crateFreed()).toEqual(ALL_FREED);
    expect(barrelFreed()).toEqual(NOTHING_FREED);

    // Evicted means gone: the next hold fetches it again. And a release that
    // takes the idle bytes past the budget evicts there and then.
    const crateAgain = cache.holdModel(CRATE, null);
    await crateAgain.object;
    expect(server.requests('crate.gltf')).toBe(2);
    crateAgain.dispose();
    expect(cache.stats).toEqual({ entries: 1, held: 0, idleBytes: oneModel });
    cache.beginFrame();
    expect(barrelFreed()).toEqual(ALL_FREED);
  });

  it('gives back once for a hold disposed twice, and never a newer load of the same file', async () => {
    stubImages();
    const server = await serveModels();
    const cache = cacheOver(server, 0);

    const kept = cache.holdModel(CRATE, null);
    const twice = cache.holdModel(CRATE, null);
    await twice.object;
    twice.dispose();
    twice.dispose();
    expect(cache.stats.held).toBe(1);

    // At a budget of 0 the last release evicts. A hold after it loads afresh,
    // and the evicted entry's holds, disposed again late, leave that load alone.
    kept.dispose();
    expect(cache.stats.entries).toBe(0);
    const fresh = cache.holdModel(CRATE, null);
    await fresh.object;
    kept.dispose();
    twice.dispose();
    expect(server.requests('crate.gltf')).toBe(2);
    expect(cache.stats).toEqual({ entries: 1, held: 1, idleBytes: 0 });
  });

  it('is fetched again by the next hold after a failed load', async () => {
    stubImages();
    const server = await serveModels();
    const cache = cacheOver(server, ROOMY);
    server.failNext('crate.gltf');

    await expect(cache.holdModel(CRATE, null).object).rejects.toThrow();
    // A failure is not kept: it would answer every later hold with itself.
    expect(cache.stats.entries).toBe(0);

    expect(await cache.holdModel(CRATE, null).object).not.toBeNull();
    expect(server.requests('crate.gltf')).toBe(2);
  });

  it('lands idle once nothing holds it, and is evicted at once at a budget of 0', async () => {
    stubImages();
    const server = await serveModels();
    const cache = cacheOver(server, 0);

    const hold = cache.holdModel(CRATE, null);
    hold.dispose();
    // Still loading: nothing to free yet, and a hold now would share the load.
    expect(cache.stats).toEqual({ entries: 1, held: 0, idleBytes: 0 });

    const freed = freedOf(partsOf(await hold.object));
    expect(cache.stats).toEqual({ entries: 0, held: 0, idleBytes: 0 });
    expect(freed()).toEqual(NOTHING_FREED);
    cache.beginFrame();
    expect(freed()).toEqual(ALL_FREED);
  });

  it('hands back one node without its descendants or its place, and null for a node the file lacks', async () => {
    stubImages();
    const server = await serveModels();
    const cache = cacheOver(server, ROOMY);

    const whole = await cache.holdModel(CRATE, null).object;
    expect(whole?.children[0]?.position.toArray()).toEqual([1, 2, 3]);

    // Each node of an unpacked model is an entity of its own, which draws its
    // children itself and carries the node's place.
    const root = await cache.holdModel(CRATE, { path: '0', name: '' }).object;
    expect(root?.children).toHaveLength(0);
    const triangle = await cache.holdModel(CRATE, { path: '0.0', name: 'Triangle' }).object;
    expect(triangle).toBeInstanceOf(Mesh);
    expect(triangle?.position.toArray()).toEqual([0, 0, 0]);
    expect(await cache.holdModel(CRATE, { path: '0.7', name: 'Nothing' }).object).toBeNull();
    expect(server.requests('crate.gltf')).toBe(1);
  });

  it('describes its nodes for a read, and holds nothing once read', async () => {
    stubImages();
    const server = await serveModels();
    const cache = cacheOver(server, ROOMY);

    const shape = await cache.modelShape(CRATE);

    expect(shape.nodes.map((node) => node.path)).toEqual(['0', '0.0']);
    expect(cache.stats.held).toBe(0);
  });
});

describe('an image', () => {
  it('is decoded once for two holds, each a clone of its own sharing the image', () => {
    const loads = stubImages({ manual: true });
    const cache = cacheOver(null, 0);

    const first = assertDefined(cache.holdTexture(BRICKS), 'a hold');
    const second = assertDefined(cache.holdTexture(BRICKS), 'a hold');

    expect(loads).toHaveLength(1);
    // Tiling and colour space live on the texture, so two materials need two …
    expect(first.texture).not.toBe(second.texture);
    // … over one decoded image.
    expect(first.texture.source).toBe(second.texture.source);
  });

  it('frees its master after the last hold, at the next frame', () => {
    const loads = stubImages({ manual: true });
    const cache = cacheOver(null, 0);
    const first = assertDefined(cache.holdTexture(BRICKS), 'a hold');
    const second = assertDefined(cache.holdTexture(BRICKS), 'a hold');
    const load = assertDefined(loads[0], 'the load');
    let freed = 0;
    load.texture.addEventListener('dispose', () => void (freed += 1));
    load.land();

    first.dispose();
    expect(cache.stats).toEqual({ entries: 1, held: 1, idleBytes: 0 });
    second.dispose();
    expect(cache.stats.entries).toBe(0);
    expect(freed).toBe(0);
    cache.beginFrame();
    expect(freed).toBe(1);
  });

  it('never flags a clone for upload once its hold is gone, though the image lands after', () => {
    const loads = stubImages({ manual: true });
    const cache = cacheOver(null, 0);
    const gone = assertDefined(cache.holdTexture(BRICKS), 'a hold');
    const kept = assertDefined(cache.holdTexture(BRICKS), 'a hold');
    // Taken before the image exists: nothing to send yet.
    expect(gone.texture.version).toBe(0);

    gone.dispose();
    assertDefined(loads[0], 'the load').land();

    expect(gone.texture.version).toBe(0);
    expect(kept.texture.version).toBeGreaterThan(0);
    expect(cache.textureReady(BRICKS)).toBe(true);
  });

  it('is no hold at all for an id the project does not know', () => {
    expect(cacheOver(null, 0).holdTexture(fixedId('asset', 'gone'))).toBeNull();
  });
});

describe('a preload', () => {
  it('holds what it loaded until its hold is given back', async () => {
    stubImages();
    const server = await serveModels();
    const cache = cacheOver(server, 0);

    const model = cache.preload(CRATE);
    const image = cache.preload(BRICKS);
    await Promise.all([model.ready, image.ready]);
    expect(cache.stats).toEqual({ entries: 2, held: 2, idleBytes: 0 });

    model.dispose();
    image.dispose();
    expect(cache.stats).toEqual({ entries: 0, held: 0, idleBytes: 0 });
  });

  it('holds nothing of a kind the cache does not load, and is ready at once', async () => {
    const cache = cacheOver(null, 0);
    const sound = cache.preload(MUSIC);
    await sound.ready;
    expect(cache.stats.entries).toBe(0);
    sound.dispose();
  });
});

describe('disposing the cache', () => {
  it('frees every entry, held or idle', async () => {
    stubImages();
    const server = await serveModels();
    const cache = cacheOver(server, ROOMY);
    const held = cache.holdModel(CRATE, null);
    const heldFreed = freedOf(partsOf(await held.object));
    const idle = cache.holdModel(BARREL, null);
    const idleFreed = freedOf(partsOf(await idle.object));
    idle.dispose();

    cache.dispose();

    expect(heldFreed()).toEqual(ALL_FREED);
    expect(idleFreed()).toEqual(ALL_FREED);
    expect(cache.stats).toEqual({ entries: 0, held: 0, idleBytes: 0 });
  });
});
