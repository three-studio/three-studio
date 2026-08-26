import { writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { app, type BrowserWindow } from 'electron';
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
