import { createServer } from 'node:http';
import { Texture, TextureLoader } from 'three/webgpu';
import { onTestFinished, vi } from 'vitest';

/*
 * Real files for the asset cache to load in Node: a glTF read by three's own
 * `GLTFLoader` over HTTP, and images answered by a stand-in for the browser's
 * decoder, which Node does not have.
 */

/** A triangle with a UV, a material and one image, placed off the origin, its buffer written inline. */
function triangleGltf(): string {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const uvs = new Float32Array([0, 0, 1, 0, 0, 1]);
  const indices = new Uint16Array([0, 1, 2]);
  // 36 + 24 + 6 bytes, padded to a multiple of four as glTF asks.
  const buffer = new Uint8Array(68);
  buffer.set(new Uint8Array(positions.buffer), 0);
  buffer.set(new Uint8Array(uvs.buffer), 36);
  buffer.set(new Uint8Array(indices.buffer), 60);

  return JSON.stringify({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'Triangle', translation: [1, 2, 3] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    textures: [{ source: 0 }],
    images: [{ uri: 'triangle.png' }],
    buffers: [{ byteLength: 68, uri: `data:application/octet-stream;base64,${Buffer.from(buffer).toString('base64')}` }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 24 },
      { buffer: 0, byteOffset: 60, byteLength: 6 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' },
      { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
  });
}

export interface ModelServer {
  /** Where a file of that name is served: every name answers the same triangle. */
  url(name: string): string;
  /** How many times a file was asked for. */
  requests(name: string): number;
  /** The next request for this file answers 404. */
  failNext(name: string): void;
}

/** The browser's event for a download's progress, which three's `FileLoader` sends as each chunk arrives. */
class ProgressEvent extends Event {
  readonly lengthComputable: boolean;
  readonly loaded: number;
  readonly total: number;

  constructor(type: string, init: { lengthComputable?: boolean; loaded?: number; total?: number } = {}) {
    super(type);
    this.lengthComputable = init.lengthComputable ?? false;
    this.loaded = init.loaded ?? 0;
    this.total = init.total ?? 0;
  }
}

/**
 * Serves the triangle on 127.0.0.1 for the length of the test that asks.
 *
 * Also gives three the two globals its loaders reach for, which a browser has
 * and Node does not: `ProgressEvent`, which `FileLoader` builds per chunk of a
 * download, and `self.URL`, which `GLTFLoader` reads when it loads an image.
 * Without them the download, or the parse, throws, and the model never lands.
 */
export async function serveModels(): Promise<ModelServer> {
  vi.stubGlobal('ProgressEvent', ProgressEvent);
  vi.stubGlobal('self', globalThis);
  const body = triangleGltf();
  const counts = new Map<string, number>();
  const failing = new Set<string>();

  const server = createServer((request, response) => {
    const name = (request.url ?? '/').slice(1);
    counts.set(name, (counts.get(name) ?? 0) + 1);
    if (failing.delete(name)) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'model/gltf+json' }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  onTestFinished(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  );

  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the model server has no port');
  return {
    url: (name) => `http://127.0.0.1:${address.port}/${name}`,
    requests: (name) => counts.get(name) ?? 0,
    failNext: (name) => void failing.add(name),
  };
}

/** One image asked of the stand-in decoder. */
export interface ImageLoad {
  readonly url: string;
  /** What the loader handed back at once, before any pixel: the cache's master. */
  readonly texture: Texture;
  /** Lands the image, as a browser's `onload` would. Once. */
  land(): void;
}

/**
 * `TextureLoader` without a DOM.
 *
 * Each load answers with a texture at once and lands it on the next task, as a
 * browser decodes an `<img>` — or, with `manual`, when the test says. The image
 * itself stays empty: what is under test is who holds the texture and when it
 * is told, not the pixels.
 */
export function stubImages(options: { readonly manual?: boolean } = {}): readonly ImageLoad[] {
  const loads: ImageLoad[] = [];
  vi.spyOn(TextureLoader.prototype, 'load').mockImplementation((url, onLoad) => {
    const texture = new Texture<HTMLImageElement>();
    let landed = false;
    const land = (): void => {
      if (landed) return;
      landed = true;
      texture.needsUpdate = true;
      onLoad?.(texture);
    };
    loads.push({ url, texture, land });
    if (options.manual !== true) setTimeout(land, 0);
    return texture;
  });
  return loads;
}
