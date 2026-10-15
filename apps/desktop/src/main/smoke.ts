import { X509Certificate } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import type { DeviceServerStatus } from '@three-studio/core';
import { BrowserWindow, app } from 'electron';
import { beginQuit } from './windows';

const PROBE = `(() => ({
  text: document.body.innerText.trim(),
  nodes: document.querySelectorAll('#root *').length,
  bg: getComputedStyle(document.body).backgroundColor,
  font: getComputedStyle(document.body).fontFamily,
  bridge: typeof window.studio,
  layoutSaved: localStorage.getItem('studio.layout') !== null,
  canvas: (() => {
    const c = document.querySelector('canvas');
    return c ? { width: c.width, height: c.height } : null;
  })(),
}))()`;

/**
 * Headless smoke test: `STUDIO_SMOKE=1 npm run dev` boots the whole Electron
 * stack, reports what the renderer actually painted, then exits.
 *
 * A blank window and a working window look identical in a build log, so this is
 * the cheapest way to tell them apart — in CI, or whenever the window cannot be
 * inspected by hand.
 *
 * - `STUDIO_SMOKE_SHOT=<path>` also writes a PNG. It goes through
 *   `capturePage`, so no macOS screen-recording permission is involved: the app
 *   photographs its own surface rather than the display.
 * - `STUDIO_SMOKE_SETUP=<js>` runs first, to drive the editor into the state
 *   being checked (select an object, add one, open a panel).
 * - `STUDIO_SMOKE_SETTLE=<ms>` waits longer after the setup than the default
 *   800ms. A setup that reloads the window — changing scene does — has a whole
 *   renderer to start again before there is anything worth measuring, and a
 *   probe that runs too early reports a half-painted page as a failure.
 */
export function runSmokeTest(win: BrowserWindow): void {
  const errors: string[] = [];
  win.webContents.on('console-message', ({ level, message }) => {
    if (level === 'error') errors.push(message);
  });

  win.webContents.once('did-finish-load', () => {
    void run(win, errors);
  });
}

/**
 * Runs script in the window, and gives up if the window goes away first.
 *
 * A setup that opens a project destroys the window it is running in — the
 * editor is a different window — and `executeJavaScript` on a webContents that
 * is torn down mid-call never settles, neither resolving nor rejecting. The
 * check then hangs with no output at all, which is the worst way for a check to
 * fail. Racing the promise against `destroyed` turns it into a sentence.
 */
function evaluate(win: BrowserWindow, script: string): Promise<unknown> {
  return Promise.race([
    win.webContents.executeJavaScript(script),
    new Promise<never>((_resolve, reject) => {
      win.once('closed', () =>
        reject(new Error('the window was closed while the script was running')),
      );
    }),
  ]);
}

async function run(win: BrowserWindow, errors: string[]): Promise<void> {
  try {
    // Long enough for React to commit *and* for the WebGPU device request and
    // the first frames to complete, otherwise the stats overlay reads as empty.
    await delay(3000);

    const setup = process.env['STUDIO_SMOKE_SETUP'];
    if (setup) {
      // The setup's return value is reported too, so a check can pull out
      // internal state that the DOM does not expose.
      const setupResult: unknown = await evaluate(win, setup);
      if (setupResult !== undefined) {
        console.log('[smoke] setup:', JSON.stringify(setupResult, null, 2));
      }
      await delay(Number(process.env['STUDIO_SMOKE_SETTLE'] ?? 800));
    }

    const result: unknown = await evaluate(win, PROBE);
    console.log('[smoke] result:', JSON.stringify(result, null, 2));
    console.log('[smoke] renderer errors:', errors.length > 0 ? errors : 'none');

    const shotPath = process.env['STUDIO_SMOKE_SHOT'];
    if (shotPath) {
      const image = await win.webContents.capturePage();
      writeFileSync(shotPath, image.toPNG());
      console.log(`[smoke] screenshot: ${shotPath}`);
    }

    beginQuit();
    app.exit(errors.length > 0 ? 1 : 0);
  } catch (error) {
    console.error('[smoke] failed:', error);
    beginQuit();
    app.exit(1);
  }
}

/**
 * A device of the harness's own: with `STUDIO_SMOKE_DEVICE=1`, a hidden window
 * opens on the device server's `localhost` link as soon as the server runs, so
 * that the real client, the real player and the real protocol run before
 * anyone picks up a phone. What its page logs is printed as `[smoke device]`.
 *
 * In a session of its own, held in memory, with the sandbox and no preload: a
 * phone gets neither the editor's content security policy nor its storage, and
 * neither should the page standing in for one. It closes when the server
 * stops — every window gone is how the app quits, and this one must never be
 * what keeps it alive — and opens again when the server runs again.
 *
 * It proves the path, not the phones: Electron's Chromium, on this computer,
 * over `localhost`, which a browser counts as a secure context.
 *
 * Under HTTPS it accepts the server's certificate the way a person pressing
 * *Proceed* does: for this window alone, and only the certificate the server
 * answers with, matched by its fingerprint. Trusting it instead, through
 * `setCertificateVerifyProc`, would hide the state a phone is in after that
 * press — Chromium keeps the error, and caches nothing received under it.
 * Nothing else in the app ever accepts a certificate the system refuses.
 */
export function followWithSmokeDevice(): (status: DeviceServerStatus) => void {
  let device: BrowserWindow | null = null;
  let fingerprint: string | null = null;
  // Electron keeps no exception from one connection to the next, so the
  // question comes back with each one: said once per certificate.
  let accepted: string | null = null;
  app.on('certificate-error', (event, webContents, _url, _error, certificate, callback) => {
    if (device === null || device.isDestroyed() || webContents !== device.webContents) return;
    let presented: string;
    try {
      presented = new X509Certificate(certificate.data).fingerprint256;
    } catch {
      return;
    }
    // Anything else is refused, as Chromium does when nobody answers.
    if (fingerprint === null || presented !== fingerprint) return;
    event.preventDefault();
    callback(true);
    if (accepted === fingerprint) return;
    accepted = fingerprint;
    console.log(`[smoke device] accepted the certificate ${fingerprint.slice(0, 23)}…`);
  });
  return (status) => {
    fingerprint = status.certificate?.fingerprint ?? null;
    if (status.state === 'stopped') {
      if (device !== null && !device.isDestroyed()) device.destroy();
      device = null;
      return;
    }
    if (status.state !== 'running' || (device !== null && !device.isDestroyed())) return;
    const url = status.urls.find((entry) => entry.address === 'localhost')?.url;
    if (url === undefined) return;

    const opened = new BrowserWindow({
      show: false,
      webPreferences: {
        partition: 'smoke-device',
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // A hidden window is a background page to Chromium, which would slow
        // its timers to a crawl — the heartbeat among them.
        backgroundThrottling: false,
      },
    });
    device = opened;
    opened.webContents.on('console-message', ({ level, message }) => {
      console.log(`[smoke device] ${level} ${message}`);
    });
    opened.webContents.on('did-fail-load', (_event, code, description, failed) => {
      console.log(`[smoke device] could not load ${failed}: ${description} (${code})`);
    });
    console.log('[smoke device] opening the localhost link');
    opened.loadURL(url).catch(() => {
      // Said by `did-fail-load`, with what failed.
    });
  };
}
