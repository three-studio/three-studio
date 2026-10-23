import { timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, extname, join } from 'node:path';
import {
  BUILD_LAYOUT,
  DEVICE_BODY_LIMIT,
  DEVICE_SCREENSHOT_LIMIT,
  DEVICE_SCREENSHOT_WAIT_MS,
  findScene,
  isDeviceId,
  isRequestId,
  type AssetEntry,
  type DeviceLaunchOptions,
  type DeviceTransport,
} from '@three-studio/core';
import { companionsOf } from '../assetScan';
import { escapeAttribute, insertIntoHead } from '../html';
import { resolveInside } from '../paths';
import { plainAddress } from './addresses';
import type { DeviceLink } from './deviceLink';
import type { Launch } from './launch';
import { launchAssetPath } from './launchManifest';
import { applyLaunchOptions } from './launchOptions';
import { readPngSize } from './screenshots';
import { WAITING_PAGE } from './waitingPage';

/*
 * What a device can ask the server for, under `/<token>/`:
 *
 *   ''                         the player when a launch is current, the waiting page otherwise,
 *                              either with the device client first in its <head>
 *   game/build.json            the launch's manifest, with the launch options the renderer reads
 *   game/scenes/<id>.json      the entry from the editor's memory, any other scene from its file
 *   game/assets/<id>/<name>    an asset by id, and the files a model names beside it
 *   game/scripts.mjs           the compiled bundle
 *   player/*, favicon.svg      the prebuilt player
 *   __studio/client.js         the device client
 *   __studio/events?device=…   a device's event stream
 *   __studio/<type>            a device's message, POSTed as JSON: the one thing answered to POST
 *   __studio/screenshot?request=…   a device's frame, POSTed as the PNG itself, when asked for
 *
 * **Nothing in the project is opened from a request path.** A scene and an
 * asset are found by id, in what the launch read from disk; a model's side
 * files come from the model's own list of them. The only path taken from a
 * request is under `player/`, which is the public build output of the player,
 * and it is resolved inside that directory. The client's folder gives out
 * `client.js` and nothing else.
 */

/** What the handler answers from, read on every request. */
export interface DeviceRoutes {
  /**
   * The first segment of every URL answered. Read on every request rather than
   * once, so that a new link refuses the old one at once — on a connection a
   * phone keeps open between requests too.
   */
  token: () => string;
  /** The prebuilt player: `index.html`, `favicon.svg` and `player/`. */
  templateDir: string;
  /** The device client's build, where `client.js` is. */
  clientDir: string;
  /** The launch to answer from: `null` until there is one, and after a stop. */
  launch: () => Launch | null;
  /**
   * The launch options, read on every request as the token is: an option
   * changed while devices run reaches the next `build.json` they fetch.
   */
  launchOptions: () => DeviceLaunchOptions;
  /** The link with each device: its streams, and what it posts. */
  link: DeviceLink;
  /** The scheme the server answers on, which a device's `Origin` names. */
  transport: () => DeviceTransport;
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

/** The query a request's URL carries, which the path's checks never read. */
function queryOf(request: IncomingMessage): URLSearchParams {
  return new URLSearchParams((request.url ?? '').split('#', 1)[0]!.split('?')[1] ?? '');
}

/** A weak validator, from what changes when the file does. */
function etagOf(size: number, mtimeMs: number): string {
  return `W/"${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`;
}

/** `__studio/<type>`, still encoded: the one path a POST may name. */
function isMessagePath(segments: readonly string[]): boolean {
  return segments.length === 2 && segments[0] === '__studio' && /^[A-Za-z]{1,32}$/.test(segments[1]!);
}

/**
 * Whether a POST comes from a page this server served.
 *
 * `Origin` names it, when there is one worth reading. A browser may send
 * `null` instead — the Fetch standard writes it for a no-cors request, WebKit
 * has been seen to write it for a same-origin one, and every answer here asks
 * for no referrer — or nothing at all. The client posts with `fetch` and a
 * referrer policy that lets the origin through, and where it is still hidden,
 * Fetch Metadata says whether the request came from the same origin. Another
 * site's page can set neither.
 */
function isSameOrigin(request: IncomingMessage, transport: DeviceTransport): boolean {
  const origin = request.headers.origin;
  if (origin === undefined || origin === 'null') {
    return request.headers['sec-fetch-site'] === 'same-origin';
  }
  const host = request.headers.host;
  return host !== undefined && origin.toLowerCase() === `${transport}://${host}`.toLowerCase();
}

/**
 * A request's body, or `null` past the limit. Read until it ends or goes past
 * the limit, never declined from `Content-Length` alone: a socket closed on a
 * body it has not read answers the sender with a reset, which can lose the
 * answer on its way.
 */
function readBody(request: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const finish = (): void => {
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
    };
    const onData = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > limit) {
        finish();
        resolve(null);
      } else {
        chunks.push(chunk);
      }
    };
    const onEnd = (): void => {
      finish();
      resolve(Buffer.concat(chunks));
    };
    const onError = (error: Error): void => {
      finish();
      reject(error);
    };
    request.on('data', onData);
    request.on('end', onEnd);
    request.on('error', onError);
  });
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
   *
   * Never `Strict-Transport-Security`, under HTTPS either. A browser told to
   * keep to HTTPS for a host refuses a changed self-signed certificate there,
   * with nothing to press to accept it — Safari was seen doing so — and this
   * computer makes a new certificate whenever it serves from a new network.
   * Browsers ignore the header for an address, but not for `localhost` or a
   * `.local` name.
   */
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');

  const token = routes.token();
  const path = (request.url ?? '').split(/[?#]/, 1)[0] ?? '';
  const [, first = '', ...rest] = path.split('/');
  const matched = path.startsWith('/') && isToken(first, token);
  const shown = matched ? `/<token>${path.slice(1 + first.length)}` : '/<not the token>';
  const trace = (status: number): void => {
    routes.trace?.(`${request.method} ${shown} ${status} (${request.socket.remoteAddress ?? '?'})`);
  };
  const notFound = (): void => {
    trace(404);
    send(request, response, 404, 'no-store', 'text/plain; charset=utf-8', 'Not found');
  };

  const isMessage = request.method === 'POST' && isMessagePath(rest);
  if (request.method !== 'GET' && request.method !== 'HEAD' && !isMessage) {
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
    response.setHeader('Location', `/${token}/`);
    send(request, response, 308, 'no-store', 'text/plain; charset=utf-8', '');
    return;
  }
  if (isMessage) {
    await receive(routes, request, response, rest[1]!, shown, trace);
    return;
  }

  const segments = decodeSegments(rest);
  if (segments === null) return notFound();
  const launch = routes.launch();
  const [head = '', ...tail] = segments;
  const single = segments.length === 1;

  if (single && head === '') {
    const page = launch
      ? await readFile(join(routes.templateDir, 'index.html'), 'utf8')
      : WAITING_PAGE;
    // In memory, on every page: the template on disk stays the one an export
    // copies, and a game someone publishes never carries the client.
    const client = `<script src="__studio/client.js" data-launch="${escapeAttribute(launch?.id ?? '')}"></script>`;
    const tagged = insertIntoHead(page, client);
    if (tagged === null) throw new Error('The player page has no <head> to put the device client in.');
    trace(200);
    send(request, response, 200, 'no-store', 'text/html; charset=utf-8', tagged);
    return;
  }
  if (single && head === 'favicon.svg') {
    const icon = join(routes.templateDir, 'favicon.svg');
    if (!(await sendFile(request, response, icon, 'revalidate'))) notFound();
    return;
  }
  if (head === BUILD_LAYOUT.player && tail.length > 0) {
    const file = inside(join(routes.templateDir, BUILD_LAYOUT.player), tail.join('/'));
    if (file === null || !(await sendFile(request, response, file, 'immutable'))) notFound();
    return;
  }
  if (head === '__studio' && tail.length === 1) {
    if (tail[0] === 'client.js') {
      // The one file served from the client's folder, named here rather than
      // taken from the request.
      const file = join(routes.clientDir, 'client.js');
      if (!(await sendFile(request, response, file, 'no-store'))) notFound();
      return;
    }
    if (tail[0] === 'events' && request.method === 'GET') {
      openStream(routes, request, response, token, trace);
      return;
    }
    return notFound();
  }
  // Everything below belongs to a launch, and before the first there is none.
  if (launch === null) return notFound();
  // Under `game/`, where an export puts the project, so a device runs the
  // layout a build has and the player resolves every path one way.
  if (head !== BUILD_LAYOUT.game) return notFound();
  const [part = '', ...within] = tail;

  if (`${head}/${part}` === BUILD_LAYOUT.manifest && within.length === 0) {
    trace(200);
    const manifest = applyLaunchOptions(launch.manifest, routes.launchOptions());
    send(request, response, 200, 'no-store', 'application/json; charset=utf-8', JSON.stringify(manifest));
    return;
  }
  if (part === 'scripts.mjs' && within.length === 0) {
    if (launch.scripts === null) return notFound();
    send(request, response, 200, 'no-store', 'text/javascript; charset=utf-8', launch.scripts);
    return;
  }
  if (part === 'scenes' && within.length > 0) {
    const name = within.join('/');
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
  if (part === 'assets' && within.length > 1) {
    const [assetId = '', ...named] = within;
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
 * A device's event stream: what the server tells it, for as long as its page
 * is open. Refused when the device is not one, or when the link holds as many
 * devices — or this device as many streams — as it takes.
 */
function openStream(
  routes: DeviceRoutes,
  request: IncomingMessage,
  response: ServerResponse,
  token: string,
  trace: (status: number) => void,
): void {
  const device = queryOf(request).get('device');
  if (!isDeviceId(device)) {
    trace(400);
    send(request, response, 400, 'no-store', 'text/plain; charset=utf-8', 'Not a device');
    return;
  }
  // Staged, not sent: a link that refuses the stream answers 503 instead.
  response.statusCode = 200;
  response.setHeader('Cache-Control', CACHE_CONTROL['no-store']);
  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  const close = routes.link.open({
    device,
    token,
    address: plainAddress(request.socket.remoteAddress ?? ''),
    stream: {
      // A phone can vanish between a write and the `close` that says so.
      write: (text) => {
        if (!response.writableEnded && !response.destroyed) response.write(text);
      },
      end: () => {
        if (!response.writableEnded) response.end();
      },
    },
  });
  if (close === null) {
    trace(503);
    send(request, response, 503, 'no-store', 'text/plain; charset=utf-8', 'Too many devices');
    return;
  }
  trace(200);
  response.on('close', close);
}

/**
 * A device's message: refused for another origin before a byte of its body is
 * read, then bounded, parsed, and handed to the link. Answered with no body:
 * the device acts on what the stream says, never on an answer.
 */
async function receive(
  routes: DeviceRoutes,
  request: IncomingMessage,
  response: ServerResponse,
  type: string,
  shown: string,
  trace: (status: number) => void,
): Promise<void> {
  const refuse = (status: number, text: string): void => {
    trace(status);
    send(request, response, status, 'no-store', 'text/plain; charset=utf-8', text);
  };
  if (!isSameOrigin(request, routes.transport())) {
    // Said with what was sent: a phone that never gets a row is most likely
    // here, and which of the two headers its browser wrote is the answer.
    const { origin, 'sec-fetch-site': site } = request.headers;
    routes.trace?.(
      `POST ${shown} 403 (${request.socket.remoteAddress ?? '?'}): ` +
        `Origin ${origin ?? 'absent'}, Sec-Fetch-Site ${String(site ?? 'absent')}`,
    );
    response.setHeader('Connection', 'close');
    send(request, response, 403, 'no-store', 'text/plain; charset=utf-8', 'Not this page’s origin');
    return;
  }
  if (type === 'screenshot') {
    await receiveScreenshot(routes, request, response, trace);
    return;
  }
  const body = await readBody(request, DEVICE_BODY_LIMIT);
  if (body === null) {
    // The rest of what was sent is not read: closed behind the answer.
    response.setHeader('Connection', 'close');
    refuse(413, 'Too large');
    return;
  }
  let message: unknown;
  try {
    message = JSON.parse(body.toString('utf8'));
  } catch {
    refuse(400, 'Not JSON');
    return;
  }
  if (routes.link.receive(type, message) === 'limited') {
    refuse(429, 'Too many messages');
    return;
  }
  response.statusCode = 204;
  response.setHeader('Cache-Control', CACHE_CONTROL['no-store']);
  response.end();
}

/** `32`, as a refusal names the limit, in MB. */
const SCREENSHOT_LIMIT_MB = DEVICE_SCREENSHOT_LIMIT / (1024 * 1024);

/**
 * A device's frame: the one POST whose body is the PNG itself, not JSON.
 *
 * Read only when it answers a request the server made and still waits for.
 * Anything else is refused before a byte of it is read, the connection closed
 * behind the answer, so that 32 MB nobody asked for are never taken in. Once
 * read, it is checked as a PNG by its header and handed over as it came. A
 * refusal from the moment the request is found ends it, in words the editor
 * shows; before that, the request still waits for the page's own upload.
 */
async function receiveScreenshot(
  routes: DeviceRoutes,
  request: IncomingMessage,
  response: ServerResponse,
  trace: (status: number) => void,
): Promise<void> {
  const refuse = (status: number, text: string): void => {
    response.setHeader('Connection', 'close');
    trace(status);
    send(request, response, status, 'no-store', 'text/plain; charset=utf-8', text);
  };
  const id = queryOf(request).get('request');
  if (!isRequestId(id)) return refuse(400, 'Not a request');
  const upload = routes.link.screenshotUpload(id);
  if (upload === null) return refuse(409, 'Nothing was asked for');
  const { label } = upload;
  const notPng = `${label} sent something that is not a PNG.`;
  const tooLarge =
    `The frame from ${label} is over ${SCREENSHOT_LIMIT_MB} MB. ` +
    'Lower the pixel ratio under Launch options.';
  const mediaType = (request.headers['content-type'] ?? '').split(';', 1)[0]!.trim().toLowerCase();
  if (mediaType !== 'image/png') {
    upload.refuse(notPng);
    return refuse(415, 'Not a PNG');
  }
  if (Number(request.headers['content-length']) > DEVICE_SCREENSHOT_LIMIT) {
    upload.refuse(tooLarge);
    return refuse(413, 'Too large');
  }
  // A phone that stops sending — asleep, off the Wi-Fi — would otherwise hold
  // the request, and the editor's toast, for as long as its socket lives.
  request.setTimeout(DEVICE_SCREENSHOT_WAIT_MS, () => request.destroy(new Error('stalled')));
  let body: Buffer | null;
  try {
    body = await readBody(request, DEVICE_SCREENSHOT_LIMIT);
  } catch {
    upload.refuse(`The upload from ${label} was cut short.`);
    response.destroy();
    return;
  } finally {
    request.setTimeout(0);
  }
  if (body === null) {
    upload.refuse(tooLarge);
    return refuse(413, 'Too large');
  }
  const size = readPngSize(body);
  if (size === null) {
    upload.refuse(notPng);
    return refuse(400, 'Not a PNG');
  }
  upload.accept(body, size);
  response.statusCode = 204;
  response.setHeader('Cache-Control', CACHE_CONTROL['no-store']);
  response.end();
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
  if (`assets/${entry.id}/${wanted}` === launchAssetPath(entry)) {
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
