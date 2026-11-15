import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

/*
 * A static server over an exported build, on 127.0.0.1, for Chrome to open
 * it from. Local and unthrottled: the first frame then measures the parse and
 * the load, and the chunks' sizes say what a network would add.
 */

/** What an exported build holds. A `.wasm` must be `application/wasm`, or it cannot compile while it streams. */
const TYPES: ReadonlyMap<string, string> = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ktx2', 'image/ktx2'],
  ['.glb', 'model/gltf-binary'],
  ['.gltf', 'model/gltf+json'],
  ['.mp3', 'audio/mpeg'],
  ['.ogg', 'audio/ogg'],
  ['.wav', 'audio/wav'],
  ['.woff2', 'font/woff2'],
]);

export function contentType(path: string): string {
  return TYPES.get(extname(path).toLowerCase()) ?? 'application/octet-stream';
}

/** The file a request names inside `root`, or `null` when it names one outside. */
function fileFor(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const target = resolve(root, `.${decoded.endsWith('/') ? `${decoded}index.html` : decoded}`);
  return target.startsWith(root + sep) ? target : null;
}

export interface StaticServer {
  /** With its trailing slash. */
  readonly url: string;
  close(): Promise<void>;
}

export async function serveFolder(root: string): Promise<StaticServer> {
  const base = resolve(root);
  const server = createServer((request, response) => {
    void (async () => {
      const file = fileFor(base, new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
      const info = file === null ? null : await stat(file).catch(() => null);
      if (file === null || info === null || !info.isFile()) {
        response.writeHead(404).end();
        return;
      }
      // Never cached: every launch is a first visit, and a fresh profile is
      // what makes it one — this keeps the server from being the exception.
      response.writeHead(200, {
        'content-type': contentType(file),
        'content-length': info.size,
        'cache-control': 'no-store',
      });
      createReadStream(file).pipe(response);
    })();
  });
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', () => listening()));
  const address = server.address();
  if (address === null || typeof address !== 'object') throw new Error('the server came up without a port');
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise((closed) => server.close(() => closed())),
  };
}
