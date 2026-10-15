import { timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, extname, join } from 'node:path';
import { findScene, type AssetEntry } from '@three-studio/core';
import { companionsOf } from '../assetScan';
import { resolveInside } from '../paths';
import type { Launch } from './launch';
import { launchAssetPath } from './launchManifest';
import { WAITING_PAGE } from './waitingPage';

/*
 * What a device can ask the server for, under `/<token>/`:
 *
 *   ''                         the player when a launch is current, the waiting page otherwise
 *   build.json                 the launch's manifest
 *   scenes/<id>.json           the entry from the editor's memory, any other scene from its file
 *   assets/<id>/<name>         an asset by id, and the files a model names beside it
 *   scripts.mjs                the compiled bundle
 *   _studio/*, favicon.svg     the prebuilt player
 *
 * **Nothing in the project is opened from a request path.** A scene and an
 * asset are found by id, in what the launch read from disk; a model's side
 * files come from the model's own list of them. The only path taken from a
 * request is under `_studio/`, which is the public build output of the player,
 * and it is resolved inside that directory.
 */

/** What the handler answers from, read on every request. */
export interface DeviceRoutes {
  /** The first segment of every URL answered. */
  token: string;
  /** The prebuilt player: `index.html`, `favicon.svg` and `_studio/`. */
  templateDir: string;
  /** The launch to answer from: `null` until there is one, and after a stop. */
  launch: () => Launch | null;
  /** Whether a request's `Host` names this machine. */
  isOwnHost: (host: string | undefined) => boolean;
  /** Called for every request, with the address it came from, before any check. */
  onRequest: (remoteAddress: string | undefined) => void;
  trace?: (line: string) => void;
}

export type DeviceRequestHandler = (request: IncomingMessage, response: ServerResponse) => void;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ktx2': 'image/ktx2',
  '.hdr': 'image/vnd.radiance',
  '.exr': 'image/x-exr',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.obj': 'model/obj',
  '.mtl': 'model/mtl',
  '.fbx': 'application/octet-stream',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.wasm': 'application/wasm',
};

function contentType(file: string): string {
  return CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * How long a device may keep what it was sent.
 *
 *  - `immutable`: the player's own bundle, whose file names carry their hash.
 *  - `revalidate`: a file that may change between launches but usually does
 *    not — an asset, the icon. Kept, and asked about with its ETag, so the
 *    next launch costs a 304 each rather than the whole project again.
 *  - `no-store`: what a launch makes, and the page. A phone that restarts on
 *    the next launch must never be handed the last one's from its cache.
 */
type Caching = 'immutable' | 'revalidate' | 'no-store';

const CACHE_CONTROL: Readonly<Record<Caching, string>> = {
  immutable: 'public, max-age=31536000, immutable',
  revalidate: 'no-cache',
  'no-store': 'no-store',
};

/** Compared in constant time, so the answer's timing says nothing about how much of a guess was right. */
function isToken(segment: string, token: string): boolean {
  const given = Buffer.from(segment);
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Each segment decoded on its own, so an encoded `/` cannot make two of one. `null` when one is malformed. */
function decodeSegments(segments: readonly string[]): string[] | null {
  try {
    return segments.map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
}

/** A weak validator, from what changes when the file does. */
function etagOf(size: number, mtimeMs: number): string {
  return `W/"${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`;
}

function isFresh(request: IncomingMessage, etag: string): boolean {
  const header = request.headers['if-none-match'];
  if (header === undefined) return false;
  const opaque = etag.replace(/^W\//, '');
  return header
    .split(',')
    .map((tag) => tag.trim().replace(/^W\//, ''))
    .some((tag) => tag === '*' || tag === opaque);
}

/**
 * The one listener the server runs, over HTTP or, later, HTTPS: it reads
 * nothing about the connection but its remote address.
 */
export function createDeviceHandler(routes: DeviceRoutes): DeviceRequestHandler {
  /*
   * A model's side files, read once per model per launch rather than once per
   * request: three's loader asks for each of them, and each answer would
   * otherwise parse the whole `.gltf` again.
   */
  const companionLists = new WeakMap<Launch, Map<string, Promise<readonly string[]>>>();

  const companionsFor = (launch: Launch, entry: AssetEntry): Promise<readonly string[]> => {
    let lists = companionLists.get(launch);
    if (lists === undefined) {
      lists = new Map();
      companionLists.set(launch, lists);
    }
    let list = lists.get(entry.id);
    if (list === undefined) {
      // A model that cannot be read names nothing, rather than failing every
      // request for its side files.
      list = companionsOf(resolveInside(launch.projectPath, entry.path)).catch(() => []);
      lists.set(entry.id, list);
    }
    return list;
  };

  return (request, response) => {
    void answer(routes, companionsFor, request, response).catch((cause: unknown) => {
      routes.trace?.(`${request.method ?? '?'} failed: ${String(cause)}`);
      if (!response.headersSent) {
        send(request, response, 500, 'no-store', 'text/plain; charset=utf-8', 'Internal error');
      } else {
        response.destroy();
      }
    });
  };
}

async function answer(
  routes: DeviceRoutes,
  companionsFor: (launch: Launch, entry: AssetEntry) => Promise<readonly string[]>,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  routes.onRequest(request.socket.remoteAddress);

  /*
   * On every response, refusals included. The token is in the page's URL, and
   * a script in the game that fetches another site would hand it over in
   * `Referer` without the first; the second stops a browser reading a file
   * the project holds as something it is not.
   */
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');

  const path = (request.url ?? '').split(/[?#]/, 1)[0] ?? '';
  const [, first = '', ...rest] = path.split('/');
  const matched = path.startsWith('/') && isToken(first, routes.token);
  const shown = matched ? `/<token>${path.slice(1 + first.length)}` : '/<not the token>';
  const trace = (status: number): void => {
    routes.trace?.(`${request.method} ${shown} ${status} (${request.socket.remoteAddress ?? '?'})`);
  };
  const notFound = (): void => {
    trace(404);
    send(request, response, 404, 'no-store', 'text/plain; charset=utf-8', 'Not found');
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    // Answered without reading what was sent, and the connection closed
    // behind it so that an unread body cannot be taken for the next request.
    response.setHeader('Connection', 'close');
    notFound();
    return;
  }
  if (!routes.isOwnHost(request.headers.host)) {
    // A name the server does not answer to is said plainly: whoever reached
    // it by a name already knows it exists, and a person who typed a `.local`
    // name it does not know learns why. A wrong token names nothing.
    trace(403);
    send(request, response, 403, 'no-store', 'text/plain; charset=utf-8', 'Unknown host name');
    return;
  }
  if (!matched) return notFound();
  if (rest.length === 0) {
    // Every URL the player makes is relative to the page, so without the
    // slash `build.json` resolves at the root and the page sits on its
    // loading screen. Typed by hand, the slash is what gets left off. The
    // target is path-absolute, so no scheme is written.
    trace(308);
    response.setHeader('Location', `/${routes.token}/`);
    send(request, response, 308, 'no-store', 'text/plain; charset=utf-8', '');
    return;
  }

  const segments = decodeSegments(rest);
  if (segments === null) return notFound();
  const launch = routes.launch();
  const [head = '', ...tail] = segments;
  const single = segments.length === 1;

  if (single && head === '') {
    const page = launch ? await readFile(join(routes.templateDir, 'index.html')) : WAITING_PAGE;
    trace(200);
    send(request, response, 200, 'no-store', 'text/html; charset=utf-8', page);
    return;
  }
  if (single && head === 'favicon.svg') {
    const icon = join(routes.templateDir, 'favicon.svg');
    if (!(await sendFile(request, response, icon, 'revalidate'))) notFound();
    return;
  }
  if (head === '_studio' && tail.length > 0) {
    const file = inside(join(routes.templateDir, '_studio'), tail.join('/'));
    if (file === null || !(await sendFile(request, response, file, 'immutable'))) notFound();
    return;
  }
  // Everything below belongs to a launch, and before the first there is none.
  if (launch === null) return notFound();

  if (single && head === 'build.json') {
    trace(200);
    send(request, response, 200, 'no-store', 'application/json; charset=utf-8', launch.manifestJson);
    return;
  }
  if (single && head === 'scripts.mjs') {
    if (launch.scripts === null) return notFound();
    send(request, response, 200, 'no-store', 'text/javascript; charset=utf-8', launch.scripts);
    return;
  }
  if (head === 'scenes' && tail.length > 0) {
    const name = tail.join('/');
    if (!name.endsWith('.json')) return notFound();
    const id = name.slice(0, -'.json'.length);
    // The entry is the scene on screen, unsaved edits and all, every time it
    // is asked for: the first load, and a script that restarts the level.
    if (id === launch.entryId) {
      send(request, response, 200, 'no-store', 'application/json; charset=utf-8', launch.entryJson);
      return;
    }
    const scene = findScene(launch.scenes, id);
    const file = scene === undefined ? null : inside(launch.projectPath, scene.path);
    if (file === null || !(await sendFile(request, response, file, 'no-store'))) notFound();
    return;
  }
  if (head === 'assets' && tail.length > 1) {
    const [assetId = '', ...named] = tail;
    const entry = launch.assets.get(assetId);
    if (entry === undefined) return notFound();
    const wanted = named.join('/');
    const file = await assetFile(launch, entry, wanted, companionsFor);
    if (file === null || !(await sendFile(request, response, file, 'revalidate'))) notFound();
    return;
  }
  notFound();
}

/**
 * The file behind `assets/<id>/<name>`, or `null`.
 *
 * The asset itself under its source's name — the scaled copy when there is
 * one, since that is what a device should download. Otherwise a side file
 * the model names, found beside the source the model was written next to,
 * never beside the copy.
 */
async function assetFile(
  launch: Launch,
  entry: AssetEntry,
  wanted: string,
  companionsFor: (launch: Launch, entry: AssetEntry) => Promise<readonly string[]>,
): Promise<string | null> {
  if (`${entry.id}/${wanted}` === launchAssetPath(entry)) {
    return inside(launch.projectPath, entry.importedPath ?? entry.path);
  }
  if (!(await companionsFor(launch, entry)).includes(wanted)) return null;
  const source = inside(launch.projectPath, entry.path);
  return source === null ? null : inside(dirname(source), wanted);
}

/** `resolveInside`, with `null` for a path that would leave the directory. */
function inside(root: string, path: string): string | null {
  try {
    return resolveInside(root, path);
  } catch {
    return null;
  }
}

function send(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  caching: Caching,
  type: string,
  body: string | Buffer,
): void {
  response.statusCode = status;
  response.setHeader('Cache-Control', CACHE_CONTROL[caching]);
  response.setHeader('Content-Type', type);
  response.setHeader('Content-Length', Buffer.byteLength(body));
  response.end(request.method === 'HEAD' ? undefined : body);
}

/** Streams a regular file. `false` when there is none there, for the caller to answer 404. */
async function sendFile(
  request: IncomingMessage,
  response: ServerResponse,
  file: string,
  caching: Caching,
): Promise<boolean> {
  let info;
  try {
    info = await stat(file);
  } catch {
    return false;
  }
  if (!info.isFile()) return false;

  response.setHeader('Cache-Control', CACHE_CONTROL[caching]);
  if (caching === 'revalidate') {
    const etag = etagOf(info.size, info.mtimeMs);
    response.setHeader('ETag', etag);
    if (isFresh(request, etag)) {
      response.statusCode = 304;
      response.end();
      return true;
    }
  }
  response.statusCode = 200;
  response.setHeader('Content-Type', contentType(file));
  response.setHeader('Content-Length', info.size);
  if (request.method === 'HEAD') {
    response.end();
    return true;
  }
  const stream = createReadStream(file);
  // A file that goes between the `stat` and the read leaves a response with
  // its headers sent: all that is left to do is cut it short.
  stream.on('error', () => response.destroy());
  stream.pipe(response);
  return true;
}
