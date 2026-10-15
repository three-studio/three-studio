import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { Agent, request as httpRequest, type OutgoingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect, createServer as createNetServer, type Server as NetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Duplex } from 'node:stream';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
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

/** The app's resources, as packaged: the player, and the device client beside it. */
async function template(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studio-server-template-'));
  const dir = join(root, 'web-template');
  await mkdir(join(dir, '_studio'), { recursive: true });
  await writeFile(join(dir, 'index.html'), TEMPLATE_HTML, 'utf8');
  await writeFile(join(dir, '_studio', 'player.js'), '// player', 'utf8');
  await deviceClient(root);
  return root;
}

async function deviceClient(root: string): Promise<void> {
  await mkdir(join(root, 'device-client'), { recursive: true });
  await writeFile(join(root, 'device-client', 'client.js'), '// client', 'utf8');
}

/** Whether a page is the player's, as the server serves it: with the device client added. */
function isPlayer(body: string): boolean {
  return body.includes('<body>player</body>') && body.includes('src="__studio/client.js"');
}

async function settingsFile(settings?: Record<string, unknown>): Promise<string> {
  const file = join(await mkdtemp(join(tmpdir(), 'studio-server-settings-')), 'devices.json');
  if (settings !== undefined) await writeFile(file, JSON.stringify(settings), 'utf8');
  return file;
}

/** Where a server keeps its certificate: beside its settings, as in the app's data directory. */
const certificateFileOf = (file: string): string => join(dirname(file), 'device-certificate.json');

function server(
  file: string,
  templateRoot: string,
  onChange?: (status: DeviceServerStatus) => void,
  trace?: (line: string) => void,
  certificateFile = certificateFileOf(file),
): DeviceServer {
  const made = new DeviceServer({
    settingsFile: file,
    certificateFile,
    templateRoots: [templateRoot],
    listenHost: '127.0.0.1',
    onChange,
    trace,
  });
  servers.push(made);
  return made;
}

/** A request, its answer, and the local port of the connection it went over. */
async function get(
  port: number,
  path: string,
  agent?: Agent,
): Promise<{ status: number; body: string; connection: number | undefined }> {
  return new Promise((resolve, reject) => {
    const sent = httpRequest({ host: '127.0.0.1', port, path, agent: agent ?? false }, (response) => {
      let body = '';
      const connection = response.socket.localPort;
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => (body += chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body, connection }));
    });
    sent.on('error', reject);
    sent.end();
  });
}

/** What a device's stream has said, read through `fetch` as a page's `EventSource` reads it. */
interface Listening {
  /** Reads until `done` holds, the stream ends, or `ms` pass; returns all that arrived. */
  until: (done: (text: string) => boolean, ms?: number) => Promise<string>;
  /** Whether the server ended the stream. */
  ended: () => boolean;
  close: () => Promise<void>;
}

async function listen(port: number, device: string, token = TOKEN): Promise<Listening> {
  const response = await fetch(`http://127.0.0.1:${port}/${token}/__studio/events?device=${device}`);
  if (response.status !== 200) throw new Error(`the stream answered ${response.status}`);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let ended = false;
  let reading: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;
  return {
    async until(done, ms = 2000) {
      const deadline = Date.now() + ms;
      while (!done(text) && !ended) {
        const left = deadline - Date.now();
        if (left <= 0) break;
        // A connection cut rather than ended — a server moved — is an end too.
        reading ??= reader.read().catch(() => ({ done: true, value: undefined }) as const);
        const read = await Promise.race([
          reading,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), left)),
        ]);
        if (read === null) break;
        reading = null;
        if (read.done) ended = true;
        else text += decoder.decode(read.value, { stream: true });
      }
      return text;
    },
    ended: () => ended,
    close: () => reader.cancel().catch(() => undefined),
  };
}

/** A device's message, from the page's own origin. */
function post(port: number, type: string, body: unknown): Promise<number> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const sent = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: `/${TOKEN}/__studio/${type}`,
        method: 'POST',
        headers: {
          host: `127.0.0.1:${port}`,
          origin: `http://127.0.0.1:${port}`,
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(payload)),
        },
        agent: false,
      },
      (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode ?? 0));
      },
    );
    sent.on('error', reject);
    sent.end(payload);
  });
}

/** A device: its stream open, and its hello said from the waiting page. */
async function device(port: number, id: string): Promise<Listening> {
  const stream = await listen(port, id);
  await stream.until((text) => text.includes('retry: 2000'));
  const status = await post(port, 'hello', {
    v: 1,
    device: id,
    launch: null,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Safari/604.1',
    screen: { width: 393, height: 852, dpr: 3 },
    secureContext: false,
    state: 'waiting',
    backend: null,
    error: null,
  });
  if (status !== 204) throw new Error(`the hello answered ${status}`);
  return stream;
}

const launchLine = (id: string | undefined): string => `"type":"launch","launch":"${id}"`;

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
    await deviceClient(empty);
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

  it('is an error without the device client, which names the command that builds it', async () => {
    const port = await freePort();
    const file = await settingsFile({ version: 1, port, token: TOKEN, transport: 'http' });
    const root = await mkdtemp(join(tmpdir(), 'studio-server-noclient-'));
    await mkdir(join(root, 'web-template'), { recursive: true });
    await writeFile(join(root, 'web-template', 'index.html'), TEMPLATE_HTML, 'utf8');

    const failed = await server(file, root).start();

    expect(failed.state).toBe('error');
    expect(failed.error).toContain('npm run build:web');
    const free = await listenOn(port);
    expect(free).not.toBeNull();
    holders.push(free!);
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
    expect(isPlayer((await get(port, `/${TOKEN}/`)).body)).toBe(true);
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
    expect(isPlayer((await get(port, `/${TOKEN}/`)).body)).toBe(true);
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

describe('choosing the address a link is made of', () => {
  it('changes what a running server shows, and moves nothing', async () => {
    const port = await freePort();
    const file = await settingsFile({ version: 1, port, token: TOKEN, transport: 'http' });
    const heard: DeviceServerStatus[] = [];
    const traced: string[] = [];
    const devices = server(
      file,
      await template(),
      (status) => heard.push(status),
      (line) => traced.push(line),
    );
    await devices.start();

    const status = await devices.saveSettings({ address: '10.9.9.9' });

    expect(status.address).toBe('10.9.9.9');
    expect((await devices.status()).address).toBe('10.9.9.9');
    expect(status.port).toBe(port);
    // The server listens on every interface already: an address only changes
    // which link is shown first, so the one listen is the start's.
    expect(traced.filter((line) => /^(started|moved)/.test(line))).toEqual([
      `started on port ${port}`,
    ]);
    await vi.waitFor(() => expect(heard.at(-1)?.address).toBe('10.9.9.9'));
    expect(JSON.parse(await readFile(file, 'utf8')).address).toBe('10.9.9.9');
  });

  it('is written while the server is stopped, which stays stopped', async () => {
    const port = await freePort();
    const { devices, file } = await keptPortServer(port);

    const status = await devices.saveSettings({ address: '10.9.9.9' });

    expect(status.state).toBe('stopped');
    expect(status.address).toBe('10.9.9.9');
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      version: 1,
      port,
      token: TOKEN,
      transport: 'http',
      future: 1,
      address: '10.9.9.9',
    });
    const free = await listenOn(port);
    expect(free).not.toBeNull();
    holders.push(free!);
  });
});

describe('a new link', () => {
  it('is answered at once, and the old one refused, on a connection already open too', async () => {
    const port = await freePort();
    const file = await settingsFile({ version: 1, port, token: TOKEN, transport: 'http' });
    const heard: DeviceServerStatus[] = [];
    const devices = server(file, await template(), (status) => heard.push(status));
    const root = await project();
    await devices.launch(root, await snapshot(root));
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    const before = await get(port, `/${TOKEN}/`, agent);
    expect(before.status).toBe(200);

    const status = await devices.regenerateToken();

    const token = JSON.parse(await readFile(file, 'utf8')).token as string;
    expect(token).not.toBe(TOKEN);
    // A phone keeps its connection open between requests: the token is
    // checked on each request, not once for the connection.
    const after = await get(port, `/${TOKEN}/`, agent);
    expect(after.status).toBe(404);
    expect(after.connection).toBe(before.connection);
    expect(isPlayer((await get(port, `/${token}/`)).body)).toBe(true);
    expect(status.port).toBe(port);
    expect(status.urls.length).toBeGreaterThan(0);
    for (const url of status.urls) expect(url.url).toContain(`:${port}/${token}/`);
    await vi.waitFor(() => expect(heard.at(-1)?.urls[0]?.url).toContain(`/${token}/`));
    agent.destroy();
  });

  it('is written while the server is stopped, and nothing listens', async () => {
    const port = await freePort();
    const { devices, file } = await keptPortServer(port);

    const status = await devices.regenerateToken();

    const written = JSON.parse(await readFile(file, 'utf8'));
    expect(written.token).not.toBe(TOKEN);
    expect(written).toEqual({ version: 1, port, token: written.token, transport: 'http', future: 1 });
    expect(status.state).toBe('stopped');
    const free = await listenOn(port);
    expect(free).not.toBeNull();
    holders.push(free!);
  });
});

describe('the devices', () => {
  it('are none while the server is stopped', async () => {
    const status = await server(await settingsFile(), await template()).status();

    expect(status.devices).toEqual([]);
  });

  it('restart on a launch, and are listed as booting in what it answers', async () => {
    const port = await freePort();
    const file = await settingsFile({ version: 1, port, token: TOKEN, transport: 'http' });
    const devices = server(file, await template());
    const root = await project();
    await devices.start();
    const phone = await device(port, 'phoneDevice00001');

    const status = await devices.launch(root, await snapshot(root));

    expect(await phone.until((text) => text.includes(launchLine(status.launch?.id)))).toContain(
      launchLine(status.launch?.id),
    );
    expect(status.devices).toMatchObject([
      { id: 'phoneDevice00001', name: 'iPhone', browser: 'Safari', state: 'booting', connected: true },
    ]);
    await phone.close();
  });

  it('hear nothing of a launch that does not compile', async () => {
    const port = await freePort();
    const file = await settingsFile({ version: 1, port, token: TOKEN, transport: 'http' });
    const devices = server(file, await template());
    const root = await project('export default class Broken {\n');
    await devices.start();
    const phone = await device(port, 'phoneDevice00002');

    await expect(devices.launch(root, await snapshot(root))).rejects.toThrow(
      'Scripts did not compile',
    );

    expect(await phone.until((text) => text.includes('"type":"launch"'), 300)).not.toContain(
      '"type":"launch"',
    );
    await phone.close();
  });
});

describe('restarting one device', () => {
  it('reaches that device alone', async () => {
    const port = await freePort();
    const file = await settingsFile({ version: 1, port, token: TOKEN, transport: 'http' });
    const devices = server(file, await template());
    const root = await project();
    await devices.start();
    const first = await device(port, 'phoneDevice00003');
    const second = await device(port, 'phoneDevice00004');
    const launched = await devices.launch(root, await snapshot(root));
    const line = launchLine(launched.launch?.id);
    await first.until((text) => text.includes(line));
    await second.until((text) => text.includes(line));

    const status = await devices.restart('phoneDevice00003');

    const twice = (text: string): boolean => text.split(line).length > 2;
    expect(twice(await first.until(twice))).toBe(true);
    expect(twice(await second.until(twice, 300))).toBe(false);
    expect(status.devices.find((one) => one.id === 'phoneDevice00003')?.state).toBe('booting');
    await first.close();
    await second.close();
  });

  it('is refused before anything is launched', async () => {
    const port = await freePort();
    const file = await settingsFile({ version: 1, port, token: TOKEN, transport: 'http' });
    const devices = server(file, await template());
    await devices.start();
    const phone = await device(port, 'phoneDevice00005');

    await expect(devices.restart('phoneDevice00005')).rejects.toThrow(
      'Nothing has been launched yet.',
    );
    await phone.close();
  });

  it('is refused for a device that is not connected', async () => {
    const port = await freePort();
    const file = await settingsFile({ version: 1, port, token: TOKEN, transport: 'http' });
    const devices = server(file, await template());
    const root = await project();
    await devices.launch(root, await snapshot(root));

    await expect(devices.restart('nobody00')).rejects.toThrow('That device is not connected.');
  });
});

describe('what ends a device’s stream', () => {
  it('a stop, which tells it first, forgets every device, and frees the port', async () => {
    const port = await freePort();
    const file = await settingsFile({ version: 1, port, token: TOKEN, transport: 'http' });
    const devices = server(file, await template());
    await devices.start();
    const phone = await device(port, 'phoneDevice00006');

    const status = await devices.stop();

    const said = await phone.until(() => false);
    expect(said).toContain('"type":"stopped"');
    expect(phone.ended()).toBe(true);
    expect(status.devices).toEqual([]);
    const free = await listenOn(port);
    expect(free).not.toBeNull();
    holders.push(free!);
  });

  it('a new link, after which the old token opens no stream and the new one does', async () => {
    const port = await freePort();
    const file = await settingsFile({ version: 1, port, token: TOKEN, transport: 'http' });
    const devices = server(file, await template());
    await devices.start();
    const phone = await device(port, 'phoneDevice00007');

    const status = await devices.regenerateToken();

    await phone.until(() => false);
    expect(phone.ended()).toBe(true);
    expect(status.devices).toEqual([]);
    await expect(listen(port, 'phoneDevice00007')).rejects.toThrow('answered 404');
    const token = JSON.parse(await readFile(file, 'utf8')).token as string;
    const again = await listen(port, 'phoneDevice00007', token);
    expect(await again.until((text) => text.includes('retry'))).toContain('retry: 2000');
    await again.close();
  });

  it('a move to another port, which lets the old one go', async () => {
    const port = await freePort();
    const target = await freePort();
    const file = await settingsFile({ version: 1, port, token: TOKEN, transport: 'http' });
    const devices = server(file, await template());
    await devices.start();
    const phone = await device(port, 'phoneDevice00008');

    await devices.saveSettings({ port: target });

    await phone.until(() => false);
    expect(phone.ended()).toBe(true);
    const old = await listenOn(port);
    expect(old).not.toBeNull();
    holders.push(old!);
  });
});

/*
 * Over HTTPS, a client trusts the server's own certificate and nothing else,
 * read from the file the server wrote: the state a phone is in once a person
 * has accepted it.
 */

/** The certificate a server under HTTPS wrote beside its settings. */
async function certificateOf(file: string): Promise<string> {
  return (JSON.parse(await readFile(certificateFileOf(file), 'utf8')) as { certificate: string })
    .certificate;
}

interface TlsAnswer {
  status: number;
  body: string;
  type: string | undefined;
  /** The certificate's SHA-256, as the client saw it in the handshake. */
  fingerprint: string;
}

/** A request over TLS that trusts `ca` alone. */
function overTls(
  port: number,
  ca: string,
  path: string,
  send: { method?: string; headers?: OutgoingHttpHeaders; body?: string } = {},
): Promise<TlsAnswer> {
  return new Promise((resolve, reject) => {
    const { method = 'GET', headers, body } = send;
    const sent = httpsRequest(
      { host: '127.0.0.1', port, path, method, headers, ca, agent: false },
      (response) => {
        const socket = response.socket as TLSSocket;
        const fingerprint = socket.getPeerX509Certificate()?.fingerprint256 ?? '';
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (text += chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            body: text,
            type: response.headers['content-type'],
            fingerprint,
          }),
        );
      },
    );
    sent.on('error', reject);
    sent.end(body);
  });
}

/** A device's message over TLS, from the origin given. */
async function postOverTls(
  port: number,
  ca: string,
  type: string,
  message: unknown,
  origin: string,
): Promise<number> {
  const body = JSON.stringify(message);
  const answer = await overTls(port, ca, `/${TOKEN}/__studio/${type}`, {
    method: 'POST',
    headers: {
      host: `127.0.0.1:${port}`,
      origin,
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
    },
    body,
  });
  return answer.status;
}

/** A device's stream over TLS, read as `listen` reads one over plain HTTP. */
function streamOverTls(
  port: number,
  ca: string,
  device: string,
): Promise<Listening & { type: string | undefined }> {
  return new Promise((resolve, reject) => {
    const path = `/${TOKEN}/__studio/events?device=${device}`;
    const sent = httpsRequest({ host: '127.0.0.1', port, path, ca, agent: false }, (response) => {
      let text = '';
      let ended = false;
      const heard = new Set<() => void>();
      const told = (): void => {
        for (const listener of heard) listener();
      };
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        text += chunk;
        told();
      });
      // A connection cut rather than ended — a server switched — is an end too.
      response.on('error', () => undefined);
      response.on('close', () => {
        ended = true;
        told();
      });
      resolve({
        type: response.headers['content-type'],
        until: (done, ms = 2000) =>
          new Promise((settle) => {
            const check = (): void => {
              if (!done(text) && !ended) return;
              heard.delete(check);
              clearTimeout(timer);
              settle(text);
            };
            const timer = setTimeout(() => {
              heard.delete(check);
              settle(text);
            }, ms);
            heard.add(check);
            check();
          }),
        ended: () => ended,
        close: async () => {
          sent.destroy();
        },
      });
    });
    sent.on('error', reject);
    sent.end();
  });
}

/**
 * What a browser that will not accept the certificate does: it begins a
 * handshake and, once the server has shown its certificate, answers with a
 * fatal alert, *unknown CA*.
 *
 * Node's own client never sends one — it checks a certificate once the
 * handshake is over — so its hello is captured, and the alert written by
 * hand. Under TLS 1.2, where an alert at that point travels in the clear:
 * OpenSSL takes no alert before a hello at all.
 */
async function refuseCertificate(port: number): Promise<void> {
  let client: TLSSocket | undefined;
  const hello = await new Promise<Buffer>((resolve) => {
    const wire = new Duplex({
      read: () => undefined,
      write: (chunk: Buffer, _encoding, done) => {
        resolve(Buffer.from(chunk));
        done();
      },
    });
    client = tlsConnect({ socket: wire, maxVersion: 'TLSv1.2', servername: 'localhost' });
    client.on('error', () => undefined);
  });
  client?.destroy();
  await new Promise<void>((resolve) => {
    const socket = connect(port, '127.0.0.1', () => socket.write(hello));
    socket.once('data', () => socket.end(Buffer.from([0x15, 0x03, 0x03, 0x00, 0x02, 0x02, 0x30])));
    socket.on('error', () => undefined);
    socket.on('close', () => resolve());
  });
}

const helloFrom = (id: string): Record<string, unknown> => ({
  v: 1,
  device: id,
  launch: null,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) Version/26.0 Safari/604.1',
  screen: { width: 393, height: 852, dpr: 3 },
  secureContext: true,
  state: 'waiting',
  backend: null,
  error: null,
});

describe('over HTTPS', () => {
  async function httpsServer(
    trace?: (line: string) => void,
  ): Promise<{ devices: DeviceServer; port: number; file: string }> {
    const port = await freePort();
    const file = await settingsFile({ version: 1, port, token: TOKEN, transport: 'https' });
    return { devices: server(file, await template(), undefined, trace), port, file };
  }

  it('starts under a certificate of its own, the one a client sees', async () => {
    const lines: string[] = [];
    const { devices, port, file } = await httpsServer((line) => lines.push(line));

    const status = await devices.start();

    expect(status.state).toBe('running');
    expect(status.transport).toBe('https');
    for (const url of status.urls) expect(url.url).toMatch(/^https:\/\//);
    const seen = await overTls(port, await certificateOf(file), `/${TOKEN}/`);
    expect(seen.status).toBe(200);
    expect(status.certificate).toEqual({
      fingerprint: seen.fingerprint,
      renewed: false,
      refusedBy: [],
    });
    expect(lines).toContain('serving https');
    expect(lines.some((line) => /^certificate made for localhost, .*127\.0\.0\.1/.test(line))).toBe(
      true,
    );
  });

  it('serves the player, the client, a stream and messages through it', async () => {
    const { devices, port, file } = await httpsServer();
    const root = await project();
    await devices.start();
    const ca = await certificateOf(file);
    const stream = await streamOverTls(port, ca, 'phoneDevice00009');

    expect(stream.type).toMatch(/^text\/event-stream/);
    expect(await stream.until((text) => text.includes('retry: 2000'))).toMatch(/^retry: 2000/);
    const hello = helloFrom('phoneDevice00009');
    // The page's own origin is the HTTPS one: the same message from the
    // plain-HTTP origin is another site's.
    expect(await postOverTls(port, ca, 'hello', hello, `http://127.0.0.1:${port}`)).toBe(403);
    expect(await postOverTls(port, ca, 'hello', hello, `https://127.0.0.1:${port}`)).toBe(204);
    expect((await devices.status()).devices.map((one) => one.id)).toEqual(['phoneDevice00009']);

    const launched = await devices.launch(root, await snapshot(root));

    const line = launchLine(launched.launch?.id);
    expect(await stream.until((text) => text.includes(line))).toContain(line);
    expect(isPlayer((await overTls(port, ca, `/${TOKEN}/`)).body)).toBe(true);
    expect((await overTls(port, ca, `/${TOKEN}/__studio/client.js`)).type).toMatch(
      /^text\/javascript/,
    );
    await stream.close();
  });

  it('keeps its certificate from one start to the next', async () => {
    const lines: string[] = [];
    const { devices } = await httpsServer((line) => lines.push(line));
    const first = await devices.start();
    await devices.stop();

    const again = await devices.start();

    expect(again.certificate?.fingerprint).toBe(first.certificate?.fingerprint);
    expect(again.certificate?.renewed).toBe(false);
    expect(lines).toContainEqual(expect.stringMatching(/^certificate kept \(\d+ names\)$/));
  });

  it('lists the address whose browser refused the certificate, until it is answered', async () => {
    const port = await freePort();
    const file = await settingsFile({ version: 1, port, token: TOKEN, transport: 'https' });
    let refused: (status: DeviceServerStatus) => void = () => undefined;
    const heard = new Promise<DeviceServerStatus>((resolve) => (refused = resolve));
    const devices = server(file, await template(), (status) => {
      if (status.certificate?.refusedBy.length) refused(status);
    });
    await devices.start();

    await refuseCertificate(port);

    expect((await heard).certificate?.refusedBy).toEqual(['127.0.0.1']);
    // Accepted, the browser loads the page again: a request from that
    // address, answered.
    await overTls(port, await certificateOf(file), `/${TOKEN}/`);
    expect((await devices.status()).certificate?.refusedBy).toEqual([]);
  });

  it('lists nobody for a refusal that a request from the same address follows', async () => {
    // A browser that accepted the certificate may still refuse it on each new
    // connection, then connect again at once past the error, as Electron's does.
    const port = await freePort();
    const file = await settingsFile({ version: 1, port, token: TOKEN, transport: 'https' });
    const heard: DeviceServerStatus[] = [];
    const devices = server(file, await template(), (status) => heard.push(status));
    await devices.start();
    const ca = await certificateOf(file);

    await refuseCertificate(port);
    await overTls(port, ca, `/${TOKEN}/`);
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    expect(heard.some((status) => (status.certificate?.refusedBy.length ?? 0) > 0)).toBe(false);
    expect((await devices.status()).certificate?.refusedBy).toEqual([]);
  });

  it('is an error, naming the certificate, when it cannot be kept', async () => {
    const port = await freePort();
    const file = await settingsFile({ version: 1, port, token: TOKEN, transport: 'https' });
    // A file where the certificate's folder should be: nothing can be written there.
    const blocker = join(dirname(file), 'blocker');
    await writeFile(blocker, '', 'utf8');
    const certificateFile = join(blocker, 'device-certificate.json');
    const devices = server(file, await template(), undefined, undefined, certificateFile);

    const status = await devices.start();

    expect(status.state).toBe('error');
    expect(status.error).toMatch(/^Could not make the HTTPS certificate: /);
    expect(status.certificate).toBeNull();
  });

  it('is not there under HTTP', async () => {
    const port = await freePort();
    const file = await settingsFile({ version: 1, port, token: TOKEN, transport: 'http' });
    const devices = server(file, await template());

    expect((await devices.status()).certificate).toBeNull();
    expect((await devices.start()).certificate).toBeNull();
    await expect(stat(certificateFileOf(file))).rejects.toThrow();
  });
});

describe('switching transport', () => {
  it('takes a running server to HTTPS on its port, and its pages with it', async () => {
    const port = await freePort();
    const file = await settingsFile({
      version: 1,
      port,
      token: TOKEN,
      transport: 'http',
      future: { a: 1 },
    });
    const heard: DeviceServerStatus[] = [];
    const devices = server(file, await template(), (status) => heard.push(status));
    await devices.start();
    const phone = await device(port, 'phoneDevice00010');

    const status = await devices.saveSettings({ transport: 'https' });

    expect(await phone.until(() => false)).toContain('"type":"reopen","transport":"https"');
    expect(phone.ended()).toBe(true);
    expect(status).toMatchObject({ state: 'running', transport: 'https', port, devices: [] });
    const seen = await overTls(port, await certificateOf(file), `/${TOKEN}/`);
    expect(seen.status).toBe(200);
    expect(seen.fingerprint).toBe(status.certificate?.fingerprint);
    // The port speaks TLS alone now: a link from before the switch reaches nothing.
    await expect(get(port, `/${TOKEN}/`)).rejects.toThrow();
    // Never stopped on the way, for the button or the smoke device.
    expect(heard.map((one) => one.state)).not.toContain('stopped');
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({
      transport: 'https',
      future: { a: 1 },
    });
  });

  it('takes it back to HTTP, then to HTTPS again under the same certificate', async () => {
    const port = await freePort();
    const file = await settingsFile({ version: 1, port, token: TOKEN, transport: 'https' });
    const devices = server(file, await template());
    const first = await devices.start();
    const ca = await certificateOf(file);
    const phone = await streamOverTls(port, ca, 'phoneDevice00011');
    await phone.until((text) => text.includes('retry: 2000'));
    const origin = `https://127.0.0.1:${port}`;
    expect(await postOverTls(port, ca, 'hello', helloFrom('phoneDevice00011'), origin)).toBe(204);

    const plain = await devices.saveSettings({ transport: 'http' });

    expect(await phone.until(() => false)).toContain('"type":"reopen","transport":"http"');
    expect(phone.ended()).toBe(true);
    expect(plain).toMatchObject({
      state: 'running',
      transport: 'http',
      port,
      certificate: null,
      devices: [],
    });
    expect((await get(port, `/${TOKEN}/`)).status).toBe(200);

    const again = await devices.saveSettings({ transport: 'https' });

    // Browsers that accepted it before need not be asked again.
    expect(again.certificate?.fingerprint).toBe(first.certificate?.fingerprint);
    expect(again.certificate?.renewed).toBe(false);
  });

  it('stays on the port it slid to', async () => {
    const port = await freePort();
    await hold(port);
    const file = await settingsFile({ version: 1, port, token: TOKEN, transport: 'http' });
    const devices = server(file, await template());
    await devices.start();

    const status = await devices.saveSettings({ transport: 'https' });

    expect(status.port).toBe(port + 1);
    expect(status.requestedPort).toBe(port);
    expect((await overTls(port + 1, await certificateOf(file), `/${TOKEN}/`)).status).toBe(200);
  });

  it('keeps the certificate when HTTPS moves to another port', async () => {
    const port = await freePort();
    const target = await freePort();
    const file = await settingsFile({ version: 1, port, token: TOKEN, transport: 'https' });
    const devices = server(file, await template());
    const first = await devices.start();

    const moved = await devices.saveSettings({ port: target });

    expect(moved.port).toBe(target);
    expect(moved.certificate?.fingerprint).toBe(first.certificate?.fingerprint);
    const seen = await overTls(target, await certificateOf(file), `/${TOKEN}/`);
    expect(seen.fingerprint).toBe(first.certificate?.fingerprint);
  });

  it('stays on HTTP when no certificate can be made, and so does the file', async () => {
    const port = await freePort();
    const file = await settingsFile({ version: 1, port, token: TOKEN, transport: 'http' });
    const blocker = join(dirname(file), 'blocker');
    await writeFile(blocker, '', 'utf8');
    const certificateFile = join(blocker, 'device-certificate.json');
    const devices = server(file, await template(), undefined, undefined, certificateFile);
    await devices.start();

    await expect(devices.saveSettings({ transport: 'https' })).rejects.toThrow(
      /^Could not make the HTTPS certificate: /,
    );

    expect((await get(port, `/${TOKEN}/`)).status).toBe(200);
    expect((await devices.status()).transport).toBe('http');
    expect(JSON.parse(await readFile(file, 'utf8')).transport).toBe('http');
  });

  it('is written while the server is stopped, and nothing listens', async () => {
    const port = await freePort();
    const file = await settingsFile({ version: 1, port, token: TOKEN, transport: 'http' });
    const devices = server(file, await template());

    const status = await devices.saveSettings({ transport: 'https' });

    expect(status).toMatchObject({ state: 'stopped', transport: 'https', certificate: null });
    expect(JSON.parse(await readFile(file, 'utf8')).transport).toBe('https');
    await expect(stat(certificateFileOf(file))).rejects.toThrow();
    const free = await listenOn(port);
    expect(free).not.toBeNull();
    holders.push(free!);
  });
});
