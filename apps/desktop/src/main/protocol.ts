import { pathToFileURL } from 'node:url';
import { net, protocol } from 'electron';
import { IMPORT_SCHEME, parseImportPreviewUrl } from '@three-studio/core';
import { importSessions } from './import/ImportSession';
import { PathEscapeError, resolveInside } from './paths';

export const ASSET_SCHEME = 'studio-asset';
/** Only host accepted; the open project is implicit, never named in the URL. */
const ASSET_HOST = 'project';

let currentProjectPath: string | null = null;

/** Called whenever a project is opened or closed. */
export function setCurrentProject(projectPath: string | null): void {
  currentProjectPath = projectPath;
}

/**
 * Must run before `app.whenReady()`. Without the privileged registration the
 * scheme cannot be fetched, cannot stream, and is treated as insecure — which
 * blocks `GLTFLoader` and any `<img>` pointing at it.
 */
export function registerAssetScheme(): void {
  const privileges = {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true,
    // Required: the renderer is served from http://localhost in dev and
    // file:// in production, so every asset request is cross-origin.
    // Without this, `GLTFLoader`'s fetch and `TextureLoader`'s
    // crossOrigin="anonymous" images are both blocked outright.
    corsEnabled: true,
  };

  protocol.registerSchemesAsPrivileged([
    { scheme: ASSET_SCHEME, privileges },
    // The same privileges for the same reason: the import dialog opens a model
    // with the same loaders the viewport uses, and they fetch and stream.
    { scheme: IMPORT_SCHEME, privileges },
  ]);
}

/**
 * Serves project files to the renderer as `studio-asset://project/<path>`.
 *
 * This exists so loaders can be handed a URL and stream the bytes themselves,
 * instead of every texture and mesh crossing the IPC boundary as a buffer.
 *
 * The URL is attacker-controlled: it comes out of scene documents, which are
 * files a user can receive from anyone. Two things keep that safe — the host
 * must be exactly `project` (so a URL cannot name a different root), and the
 * path goes through `resolveInside`, which proves it did not escape.
 */
export function handleAssetProtocol(): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    if (currentProjectPath === null) {
      return new Response('No project is open', { status: 409 });
    }

    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return new Response('Malformed asset URL', { status: 400 });
    }

    if (url.host !== ASSET_HOST) {
      return new Response('Unknown asset host', { status: 404 });
    }

    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    let absolute: string;
    try {
      absolute = resolveInside(currentProjectPath, relative);
    } catch (error) {
      if (error instanceof PathEscapeError) {
        console.warn(`[assets] blocked traversal attempt: ${relative}`);
        return new Response('Forbidden', { status: 403 });
      }
      throw error;
    }

    return serve(absolute);
  });
}

/**
 * Serves files that are being imported but are not in the project yet.
 *
 * `studio-import://session/<session>/<file>/<name>`. Both ids sit in the path
 * under a constant host, because a host is case-insensitive and an id is not;
 * the name is there for the loaders, which pick a parser from the extension and
 * resolve a `.mtl` or a `.bin` against it.
 *
 * The name is *not* what is looked up. It is checked against the file the id
 * names and against the companions that file's importer actually read out of
 * it, and anything else is a 403 — so the renderer can preview what the author
 * dropped, and cannot ask for a file by spelling out its path. Without that
 * check this scheme would be an arbitrary-read hole into the whole machine,
 * reachable from a scene document.
 */
export function handleImportProtocol(): void {
  protocol.handle(IMPORT_SCHEME, async (request) => {
    const asked = parseImportPreviewUrl(request.url);
    if (asked === null) {
      return new Response('Malformed import URL', { status: 400 });
    }

    const session = importSessions.get(asked.sessionId);
    if (session === undefined) {
      // Closed, or never opened. A preview outliving its dialog is ordinary.
      return new Response('No such import session', { status: 404 });
    }

    const absolute = session.resolvePreview(asked.fileId, asked.relativePath);
    if (absolute === null) {
      // Routine as often as not: an FBX names its textures inside itself, and
      // three's loader asks for each one beside the model. Those are not files
      // the importer declared, so they are not served — the preview is
      // untextured and the import is unaffected. Logged all the same, because
      // it is also what an attempt to read something else would look like.
      console.info(`[import] not part of this import, so not served: ${asked.relativePath}`);
      return new Response('Forbidden', { status: 403 });
    }

    return serve(absolute);
  });
}

async function serve(absolute: string): Promise<Response> {
  try {
    const file = await net.fetch(pathToFileURL(absolute).toString());
    // `corsEnabled` makes Chromium demand this header. A wildcard is safe:
    // the scheme is internal to the app and unreachable from the network.
    const headers = new Headers(file.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    return new Response(file.body, {
      status: file.status,
      statusText: file.statusText,
      headers,
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
