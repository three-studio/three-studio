import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { Agent, request as httpRequest } from 'node:http';
import { createServer as createNetServer, type Server as NetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ASSETS_DIR,
  LAUNCH_SNAPSHOT_VERSION,
  deserializeScene,
  type DeviceServerStatus,
  type LaunchSnapshot,
} from '@three-studio/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeviceServer } from '../src/main/devices/DeviceServer';
import { createProject, discoverScenes, readProject } from '../src/main/project';

/*
 * The device server, started and stopped for real on loopback: the port it
 * takes, the file it writes, and what it serves as launches come and go.
 */

const TOKEN = 'abcdefghijKLMNOPQRST01';
const TEMPLATE_HTML = '<!doctype html><html><head></head><body>player</body></html>';

const servers: DeviceServer[] = [];
const holders: NetServer[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
  await Promise.all(servers.splice(0).map((server) => server.stop()));
  await Promise.all(
    holders.splice(0).map((holder) => new Promise((resolve) => holder.close(resolve))),
  );
});

function listenOn(port: number): Promise<NetServer | null> {
  return new Promise((resolve) => {
    const holder = createNetServer();
    holder.once('error', () => resolve(null));
    holder.listen(port, '127.0.0.1', () => resolve(holder));
  });
}

/**
 * A port nothing holds, with the one above it free too, for a slide to land on.
 *
 * Below the range the system hands out on its own: every other test file runs
 * beside this one, and their connections and port-0 servers take ports from
 * that range — the one above a port found there was taken often enough to
 * fail a run in ten.
 */
async function freePort(): Promise<number> {
  for (;;) {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const probe = await listenOn(port);
    if (probe === null) continue;
    await new Promise((resolve) => probe.close(resolve));
    const above = await listenOn(port + 1);
    if (above === null) continue;
    await new Promise((resolve) => above.close(resolve));
    return port;
  }
}

/** Holds a port the way another program would. */
async function hold(port: number): Promise<void> {
  const holder = await listenOn(port);
  if (holder === null) throw new Error(`port ${port} is taken already`);
  holders.push(holder);
}

async function template(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studio-server-template-'));
  const dir = join(root, 'web-template');
  await mkdir(join(dir, '_studio'), { recursive: true });
  await writeFile(join(dir, 'index.html'), TEMPLATE_HTML, 'utf8');
  await writeFile(join(dir, '_studio', 'player.js'), '// player', 'utf8');
  return root;
}

async function settingsFile(settings?: Record<string, unknown>): Promise<string> {
  const file = join(await mkdtemp(join(tmpdir(), 'studio-server-settings-')), 'devices.json');
  if (settings !== undefined) await writeFile(file, JSON.stringify(settings), 'utf8');
  return file;
}

function server(
  file: string,
  templateRoot: string,
  onChange?: (status: DeviceServerStatus) => void,
): DeviceServer {
  const made = new DeviceServer({
    settingsFile: file,
    templateRoots: [templateRoot],
    listenHost: '127.0.0.1',
    onChange,
  });
  servers.push(made);
  return made;
}

async function get(port: number, path: string, agent?: Agent): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const sent = httpRequest({ host: '127.0.0.1', port, path, agent: agent ?? false }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => (body += chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
    });
    sent.on('error', reject);
    sent.end();
  });
}

async function project(script?: string): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), 'studio-server-project-'));
  const root = (await createProject('Races', parent)).summary.path;
  if (script !== undefined) {
    await mkdir(join(root, ASSETS_DIR, 'scripts'), { recursive: true });
    await writeFile(join(root, ASSETS_DIR, 'scripts', 'Spin.ts'), script, 'utf8');
  }
  return root;
}

async function snapshot(root: string, exposure = 1): Promise<LaunchSnapshot> {
  const [entry] = await discoverScenes(root);
  const { settings } = await readProject(root);
  return {
    version: LAUNCH_SNAPSHOT_VERSION,
    entry: {
      id: entry!.id,
      name: entry!.name,
      scene: deserializeScene(await readFile(join(root, entry!.path), 'utf8')),
    },
    materials: {},
    prefabs: {},
    rendering: { ...settings.rendering, exposure },
    physics: settings.physics,
    loadingScene: null,
  };
}

describe('a server that is stopped', () => {
  it('shows the settings’ port and transport, and writes nothing', async () => {
    const file = await settingsFile();

    const status = await server(file, await template()).status();

    expect(status).toMatchObject({
      state: 'stopped',
      transport: 'http',
      port: 7700,
      requestedPort: 7700,
      urls: [],
      selectedUrl: null,
      launch: null,
      reachedFromNetwork: false,
    });
    await expect(stat(file)).rejects.toThrow();
  });
});

describe('starting', () => {
  it('listens on the kept port, behind the file’s token', async () => {
    const port = await freePort();
    const file = await settingsFile({ version: 1, port, token: TOKEN, transport: 'http' });

    const status = await server(file, await template()).start();

    expect(status.state).toBe('running');
    expect(status.port).toBe(port);
    expect(status.requestedPort).toBe(port);
    expect(status.urls.at(-1)).toEqual({
      address: 'localhost',
      label: 'This computer',
      url: `http://localhost:${port}/${TOKEN}/`,
    });
    for (const url of status.urls) expect(url.url).toContain(`:${port}/${TOKEN}/`);
    expect(status.selectedUrl).not.toBeNull();
    expect((await get(port, `/${TOKEN}/`)).body).toContain('Nothing is running yet');
  });

  it('writes a token that will not do once, and keeps it after', async () => {
    const port = await freePort();
    const file = await settingsFile({ version: 1, port, token: 'short', transport: 'http' });
    const devices = server(file, await template());

    const first = await devices.start();
    const written = await readFile(file, 'utf8');
    await devices.stop();
    const second = await devices.start();

    expect(await readFile(file, 'utf8')).toBe(written);
    expect(second.urls).toEqual(first.urls);
    expect(JSON.parse(written).token).not.toBe('short');
  });

  it('changes nothing when started again', async () => {
    const port = await freePort();
    const file = await settingsFile({ version: 1, port, token: TOKEN, transport: 'http' });
    const devices = server(file, await template());

    const [first, second] = await Promise.all([devices.start(), devices.start()]);
    const third = await devices.start();

    expect(first.port).toBe(port);
    expect(second.port).toBe(port);
    expect(third.port).toBe(port);
  });

  it('slides to the next port when the kept one is held, and the file keeps its own', async () => {
    const port = await freePort();
    await hold(port);
    const file = await settingsFile({ version: 1, port, token: TOKEN, transport: 'http' });

    const status = await server(file, await template()).start();

    expect(status.state).toBe('running');
    expect(status.port).toBe(port + 1);
    expect(status.requestedPort).toBe(port);
    expect(JSON.parse(await readFile(file, 'utf8')).port).toBe(port);
  });

  it('is an error without a player, and runs once there is one', async () => {
    const port = await freePort();
    const file = await settingsFile({ version: 1, port, token: TOKEN, transport: 'http' });
    const empty = await mkdtemp(join(tmpdir(), 'studio-server-noplayer-'));
    const devices = server(file, empty);

    const failed = await devices.start();
    expect(failed.state).toBe('error');
    expect(failed.error).toContain('The web player has not been built');

    const built = join(empty, 'web-template');
    await mkdir(built, { recursive: true });
    await writeFile(join(built, 'index.html'), TEMPLATE_HTML, 'utf8');
    const running = await devices.start();
    expect(running.state).toBe('running');
    expect(running.error).toBeUndefined();
  });
});

describe('stopping', () => {
  it('frees the port at once, even with a keep-alive connection open', async () => {
    const port = await freePort();
    const file = await settingsFile({ version: 1, port, token: TOKEN, transport: 'http' });
    const devices = server(file, await template());
    await devices.start();
    const agent = new Agent({ keepAlive: true });
    expect((await get(port, `/${TOKEN}/`, agent)).status).toBe(200);

    const stopped = await devices.stop();

    expect(stopped.state).toBe('stopped');
    expect(stopped.urls).toEqual([]);
    const again = await listenOn(port);
    expect(again).not.toBeNull();
    holders.push(again!);
    agent.destroy();
  });
});

describe('launching', () => {
  it('starts a stopped server, and the page becomes the player', async () => {
    const port = await freePort();
    const file = await settingsFile({ version: 1, port, token: TOKEN, transport: 'http' });
    const devices = server(file, await template());
    const root = await project();

    const status = await devices.launch(root, await snapshot(root));

    expect(status.state).toBe('running');
    expect(status.launch?.sceneName).toBe((await discoverScenes(root))[0]!.name);
    expect((await get(port, `/${TOKEN}/`)).body).toBe(TEMPLATE_HTML);
  });

  it('replaces build.json with each launch', async () => {
    const port = await freePort();
    const file = await settingsFile({ version: 1, port, token: TOKEN, transport: 'http' });
    const devices = server(file, await template());
    const root = await project();

    const first = await devices.launch(root, await snapshot(root, 1.25));
    const second = await devices.launch(root, await snapshot(root, 2.5));

    expect(second.launch?.id).not.toBe(first.launch?.id);
    const served = JSON.parse((await get(port, `/${TOKEN}/build.json`)).body);
    expect(served.rendering.exposure).toBe(2.5);
  });

  it('is refused when the scripts do not compile, and leaves the server stopped', async () => {
    const port = await freePort();
    const file = await settingsFile({ version: 1, port, token: TOKEN, transport: 'http' });
    const devices = server(file, await template());
    const root = await project('export default class Broken {\n');

    await expect(devices.launch(root, await snapshot(root))).rejects.toThrow(
      'Scripts did not compile',
    );

    expect((await devices.status()).state).toBe('stopped');
    const free = await listenOn(port);
    expect(free).not.toBeNull();
    holders.push(free!);
  });

  it('drops a launch a stop overtook while it was prepared', async () => {
    const port = await freePort();
    const file = await settingsFile({ version: 1, port, token: TOKEN, transport: 'http' });
    const devices = server(file, await template());
    const root = await project('export default class Spin {}\n');

    const launching = devices.launch(root, await snapshot(root));
    await devices.stop();
    const status = await launching;

    expect(status.state).toBe('stopped');
    expect(status.launch).toBeNull();
    expect((await devices.status()).launch).toBeNull();
  });

  it('forgets the launch when stopped, and serves the waiting page when started again', async () => {
    const port = await freePort();
    const file = await settingsFile({ version: 1, port, token: TOKEN, transport: 'http' });
    const devices = server(file, await template());
    const root = await project();
    await devices.launch(root, await snapshot(root));

    await devices.stop();
    const restarted = await devices.start();

    expect(restarted.launch).toBeNull();
    expect((await get(port, `/${TOKEN}/`)).body).toContain('Nothing is running yet');
    expect((await get(port, `/${TOKEN}/build.json`)).status).toBe(404);
  });
});

describe('what the editor is told', () => {
  it('hears every new status, in order', async () => {
    const port = await freePort();
    const file = await settingsFile({ version: 1, port, token: TOKEN, transport: 'http' });
    const heard: DeviceServerStatus[] = [];
    const devices = server(file, await template(), (status) => heard.push(status));
    const root = await project();

    await devices.start();
    await devices.launch(root, await snapshot(root));
    await devices.stop();
    // Handed over in turn, so the last may arrive just after `stop` resolves.
    await vi.waitFor(() => expect(heard).toHaveLength(4));

    expect(heard.map((status) => status.state)).toEqual([
      'starting',
      'running',
      'running',
      'stopped',
    ]);
    expect(heard[1]!.launch).toBeNull();
    expect(heard[2]!.launch?.sceneName).toBeDefined();
    expect(heard[3]!.urls).toEqual([]);
  });

  it('is told nothing by a stop that had nothing to stop', async () => {
    const heard: DeviceServerStatus[] = [];
    const devices = server(await settingsFile(), await template(), (status) => heard.push(status));

    await devices.stop();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(heard).toEqual([]);
  });
});

/**
 * Holds a port from another `node`, the way another Three Studio would: the
 * test runner is `node` too, so it is this same program.
 */
async function holdFromChild(port: number, ignoreTerm = false): Promise<ChildProcess> {
  const script = [
    ignoreTerm ? "process.on('SIGTERM', () => {});" : '',
    `require('net').createServer().listen(${port}, '127.0.0.1', () => process.stdout.write('ready'));`,
  ].join('\n');
  const child = spawn(process.execPath, ['-e', script]);
  children.push(child);
  await new Promise((resolve, reject) => {
    child.stdout!.once('data', resolve);
    child.once('exit', () => reject(new Error('the holder exited before it held the port')));
  });
  return child;
}

function isAlive(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

function exited(child: ChildProcess): Promise<void> {
  return isAlive(child) ? new Promise((resolve) => child.once('exit', () => resolve())) : Promise.resolve();
}

async function keptPortServer(port: number): Promise<{ devices: DeviceServer; file: string }> {
  const file = await settingsFile({ version: 1, port, token: TOKEN, transport: 'http', future: 1 });
  return { devices: server(file, await template()), file };
}

describe('a kept port held by another Three Studio', () => {
  it('is named, with the same program, while the server runs on the next one', async () => {
    const port = await freePort();
    const child = await holdFromChild(port);
    const { devices } = await keptPortServer(port);

    const status = await devices.start();

    expect(status.port).toBe(port + 1);
    expect(status.requestedPort).toBe(port);
    expect(status.portHolder).toMatchObject({ pid: child.pid, sameApp: true });
    expect(await realpath(status.portHolder!.program!)).toBe(await realpath(process.execPath));
  });

  it('is left alone when the person declines', async () => {
    const port = await freePort();
    const child = await holdFromChild(port);
    const { devices } = await keptPortServer(port);
    await devices.start();
    const asked: number[] = [];

    const status = await devices.reclaimPort(async (holder) => {
      asked.push(holder.pid);
      return false;
    });

    expect(asked).toEqual([child.pid]);
    expect(isAlive(child)).toBe(true);
    expect(status.port).toBe(port + 1);
  });

  it('is quit when the person agrees, and the server moves back with its launch', async () => {
    const port = await freePort();
    const child = await holdFromChild(port);
    const { devices } = await keptPortServer(port);
    const root = await project();
    const launched = await devices.launch(root, await snapshot(root));

    const status = await devices.reclaimPort(async () => true);
    await exited(child);

    expect(status.port).toBe(port);
    expect(status.requestedPort).toBe(port);
    expect(status.portHolder).toBeNull();
    expect(status.launch?.id).toBe(launched.launch?.id);
    expect((await get(port, `/${TOKEN}/`)).body).toBe(TEMPLATE_HTML);
    // The port it slid to is let go.
    const slid = await listenOn(port + 1);
    expect(slid).not.toBeNull();
    holders.push(slid!);
  });

  it('is killed when it ignores being asked to quit', { timeout: 15_000 }, async () => {
    const port = await freePort();
    const child = await holdFromChild(port, true);
    const { devices } = await keptPortServer(port);
    await devices.start();

    const status = await devices.reclaimPort(async () => true);
    await exited(child);

    expect(child.signalCode).toBe('SIGKILL');
    expect(status.port).toBe(port);
  });
});

describe('a kept port that came free', () => {
  it('is taken back without asking anyone', async () => {
    const port = await freePort();
    await hold(port);
    const { devices } = await keptPortServer(port);
    await devices.start();
    await new Promise((resolve) => holders.pop()!.close(resolve));

    const status = await devices.reclaimPort(async () => {
      throw new Error('nobody should have been asked');
    });

    expect(status.port).toBe(port);
    expect(status.portHolder).toBeNull();
  });
});

describe('choosing another port', () => {
  it('moves a running server, and the file keeps what it held', async () => {
    const port = await freePort();
    const target = await freePort();
    const { devices, file } = await keptPortServer(port);
    await devices.start();

    const status = await devices.saveSettings({ port: target });

    expect(status.port).toBe(target);
    expect(status.requestedPort).toBe(target);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      version: 1,
      port: target,
      token: TOKEN,
      transport: 'http',
      future: 1,
    });
    expect((await get(target, `/${TOKEN}/`)).status).toBe(200);
    const old = await listenOn(port);
    expect(old).not.toBeNull();
    holders.push(old!);
  });

  it('slides from a busy port, as a start does', async () => {
    const port = await freePort();
    const target = await freePort();
    await hold(target);
    const { devices } = await keptPortServer(port);
    await devices.start();

    const status = await devices.saveSettings({ port: target });

    expect(status.port).toBe(target + 1);
    expect(status.requestedPort).toBe(target);
  });

  it('only writes the file while the server is stopped', async () => {
    const port = await freePort();
    const { devices, file } = await keptPortServer(port);

    const status = await devices.saveSettings({ port: port + 1 });

    expect(status.state).toBe('stopped');
    expect(status.port).toBe(port + 1);
    expect(JSON.parse(await readFile(file, 'utf8')).port).toBe(port + 1);
  });
});
