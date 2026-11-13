import { spawn } from 'node:child_process';
import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { finishRun } from '../page/editor';
import { CdpSession, collectErrors, listTargets, recordAt, runInPage, stringAt } from './cdp';

/*
 * The production editor, launched under the smoke harness and driven over CDP.
 *
 * `npm run build`'s output, run unpackaged by the Electron binary: the bundles
 * `electron-builder` packages, byte for byte. The smoke harness opens the
 * project without a prompt and keeps the window up for as long as its setup
 * waits — here, until the driver sets `window.__perfDone`.
 */

/**
 * `display` is the editor as shipped, held to the display's rate. `uncapped`
 * frees the frame from vsync, so a frame's time is its work: at 120 Hz a
 * vsync-bound median does not move until a frame misses its slot.
 */
export type LaunchMode = 'display' | 'uncapped';

export interface EditorLaunch {
  /** The repository: where the binary and `apps/desktop` are. */
  readonly repo: string;
  /** The run's folder. The application data and the logs go inside it. */
  readonly runDir: string;
  readonly project: string;
  readonly mode: LaunchMode;
  /** Names the launch's log, `<runDir>/logs/<label>.log`. */
  readonly label: string;
  readonly port: number;
}

/** The smoke harness's setup: hold the window up until the driver is done. */
const HOLD_UNTIL_DONE =
  'new Promise((done) => { const wait = () => (window.__perfDone === true ? done(undefined) : setTimeout(wait, 100)); wait(); })';

/**
 * What a launch inherits from the shell, less what would steer it: a stray
 * `STUDIO_SMOKE_SHOT` or `ELECTRON_RENDERER_URL` from someone's terminal, or
 * Vitest's own variables, which the app was never run under.
 */
function inheritedEnvironment(): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || /^(STUDIO_|VITEST|ELECTRON_RENDERER_URL$|NODE_ENV$)/.test(key)) continue;
    kept[key] = value;
  }
  return kept;
}

/** What `spawn` is given for a launch. Pure, so a test reads it without launching anything. */
export function editorCommand(
  launch: EditorLaunch,
  binary: string,
): { command: string; args: string[]; env: Record<string, string> } {
  return {
    command: binary,
    args: [
      join(launch.repo, 'apps/desktop'),
      // The harness's own application data: the user's is never read or
      // written, and every run starts from the default layout and shortcuts.
      `--user-data-dir=${join(launch.runDir, 'user-data')}`,
      `--remote-debugging-port=${launch.port}`,
      // A window covered by another app goes on drawing.
      '--disable-backgrounding-occluded-windows',
      ...(launch.mode === 'uncapped' ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : []),
    ],
    env: {
      ...inheritedEnvironment(),
      STUDIO_SMOKE: '1',
      STUDIO_SMOKE_PROJECT: launch.project,
      STUDIO_SMOKE_SETTLE: '0',
      STUDIO_SMOKE_SETUP: HOLD_UNTIL_DONE,
    },
  };
}

/** The Electron binary `npm install` put in the repository, as `electron` itself finds it. */
export async function electronBinary(repo: string): Promise<string> {
  const relative = (await readFile(join(repo, 'node_modules/electron/path.txt'), 'utf8')).trim();
  return join(repo, 'node_modules/electron/dist', relative);
}

export interface EditorExit {
  readonly code: number | null;
  /** What the smoke harness printed after `[smoke] renderer errors:` — `none` when there were none. */
  readonly rendererErrors: string;
  /**
   * How many times Chromium said its GPU process died. Once per uncapped
   * launch, at start: `--disable-frame-rate-limit` crashes the first GPU process
   * of Electron 43 (exit code 11), Chromium starts another before the editor
   * asks for a device, and the editor runs as it should. Reported, so that one
   * at any other time is seen.
   */
  readonly gpuProcessCrashes: number;
}

export interface EditorInstance {
  /** Attached to the editor's page, with the console read and the focus emulated. */
  readonly session: CdpSession;
  /** Console errors and exceptions seen over CDP since the page committed. */
  readonly errors: readonly string[];
  readonly logPath: string;
  /** Lets the app exit, and answers how it did. */
  finish(): Promise<EditorExit>;
  /** Ends the app's whole process group, at once. */
  kill(): void;
}

const isEditorPage = (url: string): boolean => {
  try {
    return new URL(url).pathname.endsWith('/out/renderer/index.html');
  } catch {
    return false;
  }
};

async function until<T>(what: string, timeoutMs: number, probe: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await probe();
    if (found !== null) return found;
    await delay(20);
  }
  throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
}

function rendererErrorsIn(log: string): string {
  const marker = '[smoke] renderer errors:';
  const at = log.indexOf(marker);
  if (at < 0) return 'not printed';
  const rest = log.slice(at + marker.length).trimStart();
  const end = rest.search(/\n\[/);
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

export async function launchEditor(launch: EditorLaunch): Promise<EditorInstance> {
  const command = editorCommand(launch, await electronBinary(launch.repo));
  await mkdir(join(launch.runDir, 'logs'), { recursive: true });
  // Every launch on the default layout. The editor saves the dock's layout as
  // it loads, and a saved layout comes back two pixels off: the edit canvas
  // grew 4 × 2 device pixels a launch (1876 × 1146, 1880 × 1148, 1884 × 1150),
  // and the GPU memory with it, 134 kB a launch. The rest of the application
  // data stays, warm: the shader and code caches are what a warm-up is for.
  await rm(join(launch.runDir, 'user-data', 'layouts.json'), { force: true });
  const logPath = join(launch.runDir, 'logs', `${launch.label}.log`);
  const log = await open(logPath, 'w');
  // A process group of its own, so that ending it ends the GPU and renderer
  // processes with it: Electron's children survive their parent's death.
  const child = spawn(command.command, command.args, {
    env: command.env,
    stdio: ['ignore', log.fd, log.fd],
    detached: true,
  });
  const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
  await log.close();
  const kill = (): void => {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  };

  try {
    const target = await until('the editor page', 60_000, async () => {
      const targets = await listTargets(launch.port);
      return targets?.find((candidate) => candidate.type === 'page' && isEditorPage(candidate.url)) ?? null;
    });
    const session = await CdpSession.open(target.webSocketDebuggerUrl);

    /*
     * Nothing that runs script in the page until its document has committed.
     *
     * The target exists before the editor's document does, and evaluating in
     * the empty one it starts with — `Runtime.evaluate` or `Runtime.enable` —
     * makes Electron's sandboxed preload bundle fail with "Cannot destructure
     * property 'preloadScripts' of 'binding.startupData' as it is null". The
     * window still works, and the smoke harness counts the error, so every
     * launch would exit 1. `Page.getFrameTree` runs no script: polled until
     * the frame is the editor's page, it lets the driver in about a quarter of
     * a second after navigation, well before a scene is drawn.
     */
    await until('the editor document to commit', 30_000, async () => {
      const tree = recordAt(await session.send('Page.getFrameTree'), 'frameTree');
      return isEditorPage(stringAt(recordAt(tree, 'frame'), 'url')) ? true : null;
    });

    const errors = collectErrors(session);
    await session.send('Runtime.enable');
    // The window opens without the focus (`showInactive` under the harness),
    // and a page that believes it has none pauses what waits on it.
    await session.send('Emulation.setFocusEmulationEnabled', { enabled: true });

    return {
      session,
      errors,
      logPath,
      kill,
      finish: async () => {
        // The window may already be gone — a launch that failed — and the app
        // then exits by itself, or is ended below.
        await runInPage(session, finishRun, undefined, 10_000).catch(() => undefined);
        session.close();
        const code = await Promise.race([exited, delay(60_000, 'timeout' as const)]);
        if (code === 'timeout') kill();
        const text = await readFile(logPath, 'utf8');
        return {
          code: code === 'timeout' ? null : code,
          rendererErrors: rendererErrorsIn(text),
          gpuProcessCrashes: text.split('GPU process exited unexpectedly').length - 1,
        };
      },
    };
  } catch (error) {
    kill();
    throw error;
  }
}
