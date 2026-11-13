import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { CdpSession, browserEndpoint, collectErrors, freePort, listTargets } from './cdp';

/*
 * Chrome, for exported builds: a fresh profile per launch, which is a first
 * visit, opened behind the person's work.
 *
 * Through `open -g -n`, which starts a new instance without bringing it
 * forward, and hands back no pid: the instance is found, and if need be ended,
 * by its profile's path, which no other Chrome carries.
 */

const run = promisify(execFile);

export function chromeCommand(profile: string, port: number, log: string): { command: string; args: string[] } {
  return {
    command: 'open',
    args: [
      '-g',
      '-n',
      '-a',
      'Google Chrome',
      // Chrome's own output, which `open` would otherwise drop: the one place it
      // says why it did not start, or did not listen.
      '--stdout',
      log,
      '--stderr',
      log,
      '--args',
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${port}`,
      '--no-first-run',
      '--no-default-browser-check',
      // A background window keeps its frame rate and its timers.
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--window-size=1512,945',
      'about:blank',
    ],
  };
}

export interface ChromeInstance {
  /** Attached to its one page, still on `about:blank`, with the console read. */
  readonly session: CdpSession;
  readonly errors: readonly string[];
  /** Closes the browser and removes its profile. */
  close(): Promise<void>;
}

/**
 * Whether a process of this profile's Chrome still runs. The `--` matters: a
 * pattern opening with `--user-data-dir` is otherwise read as an option, pgrep
 * fails, and the answer was always no — so a Chrome was never ended.
 */
async function processesOf(profile: string): Promise<boolean> {
  try {
    await run('pgrep', ['-f', '--', `--user-data-dir=${profile}`]);
    return true;
  } catch {
    return false;
  }
}

export async function launchChrome(runDir: string): Promise<ChromeInstance> {
  const profile = await mkdtemp(join(runDir, 'chrome-'));
  const port = await freePort();
  await mkdir(join(runDir, 'logs'), { recursive: true });
  const log = join(runDir, 'logs', `${basename(profile)}.log`);
  const command = chromeCommand(profile, port, log);
  await new Promise<void>((resolve, reject) => {
    spawn(command.command, command.args, { stdio: 'ignore' })
      .once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`open exited ${code}`))))
      .once('error', reject);
  });

  const end = async (): Promise<void> => {
    const browser = await browserEndpoint(port);
    if (browser !== null) {
      const session = await CdpSession.open(browser);
      await session.send('Browser.close').catch(() => undefined);
      session.close();
    }
    for (let i = 0; i < 100 && (await processesOf(profile)); i += 1) await delay(100);
    if (await processesOf(profile)) await run('pkill', ['-f', '--', `--user-data-dir=${profile}`]).catch(() => undefined);
    await rm(profile, { recursive: true, force: true });
  };

  try {
    let page = null;
    for (let i = 0; i < 300 && page === null; i += 1) {
      page = (await listTargets(port))?.find((target) => target.type === 'page') ?? null;
      if (page === null) await delay(50);
    }
    if (page === null) {
      const said = await readFile(log, 'utf8').catch(() => '');
      throw new Error(`Chrome opened no page on port ${port}. It said:\n${said.slice(-2000)}`);
    }
    const session = await CdpSession.open(page.webSocketDebuggerUrl);
    const errors = collectErrors(session);
    await session.send('Runtime.enable');
    await session.send('Page.enable');
    return {
      session,
      errors,
      close: async () => {
        session.close();
        await end();
      },
    };
  } catch (error) {
    await end();
    throw error;
  }
}
