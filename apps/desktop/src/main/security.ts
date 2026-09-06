import { ASSET_SCHEME, IMPORT_SCHEME } from '@three-studio/core';
import type { Session } from 'electron';

/**
 * The two schemes the main process serves, as a CSP source list.
 *
 * Written out six times before this, which is six chances to rename a scheme in
 * `core` and leave the policy still naming the old one — and a CSP that refuses
 * a scheme is every texture in the project failing to load, with the reason in
 * a console nobody has open.
 */
const SERVED_SCHEMES = `${ASSET_SCHEME}: ${IMPORT_SCHEME}:`;

/**
 * The renderer runs sandboxed with no Node access, so the CSP is the second
 * line of defence: it decides what a malicious project file or user script can
 * reach once it is already executing.
 *
 * `blob:` is required in script-src and worker-src — three.js loaders spawn
 * blob workers (DRACO, KTX2) and compiled user scripts are imported as blobs.
 */
const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${SERVED_SCHEMES}`,
  "font-src 'self' data:",
  `media-src 'self' blob: ${SERVED_SCHEMES}`,
  `connect-src 'self' data: blob: ${SERVED_SCHEMES}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/** Vite's dev server needs inline styles, eval for sourcemaps, and a websocket. */
const DEVELOPMENT_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${SERVED_SCHEMES}`,
  "font-src 'self' data:",
  `media-src 'self' blob: ${SERVED_SCHEMES}`,
  `connect-src 'self' data: blob: ${SERVED_SCHEMES} ws://localhost:* http://localhost:*`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ');

/**
 * Permissions the editor genuinely needs.
 *
 * `pointerLock` is not optional: mouse look in play mode is built on it, and
 * Electron routes `requestPointerLock()` through the permission handler. Denying
 * everything left the camera unable to turn, with no error anywhere — the
 * request simply never resolved.
 *
 * `fullscreen` is here so a game can go fullscreen from the Game view.
 */
const ALLOWED_PERMISSIONS = new Set(['pointerLock', 'fullscreen', 'keyboardLock']);

export function applyContentSecurityPolicy(target: Session, isDev: boolean): void {
  const policy = isDev ? DEVELOPMENT_CSP : PRODUCTION_CSP;

  target.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    });
  });

  // Nothing here needs the camera, the microphone, geolocation or USB.
  target.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  // Chromium asks synchronously for some of the same permissions; a handler
  // that only answers the async form still blocks those.
  target.setPermissionCheckHandler((_contents, permission) =>
    ALLOWED_PERMISSIONS.has(permission),
  );
}
