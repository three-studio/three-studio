import { createServer, type Server } from 'node:http';
import { hostname, networkInterfaces } from 'node:os';
import type {
  DeviceServerState,
  DeviceServerStatus,
  DeviceSettings,
  LaunchSnapshot,
} from '@three-studio/core';
import { findTemplate } from '../exportWeb';
import {
  deviceUrls,
  isFromOutside,
  isOwnHost,
  listAddresses,
  plainAddress,
  selectedUrl,
  type ListedAddress,
} from './addresses';
import { prepareLaunch, type Launch } from './launch';
import { createDeviceHandler, type DeviceRequestHandler } from './routes';
import { ensureDeviceSettings, readDeviceSettings } from './settingsFile';

export interface DeviceServerOptions {
  /** `devices.json`, in the app's data directory. */
  settingsFile: string;
  /** Where to look for the prebuilt player, as the exporter looks. */
  templateRoots: readonly string[];
  /**
   * The interface to listen on. Unset in the app, which listens on every one:
   * a phone has to reach it, and the token and the `Host` check are what keep
   * it to the people meant. Tests pass `127.0.0.1`, so that running them never
   * raises a firewall's prompt.
   */
  listenHost?: string;
  /** Every new status, in the order they happened. */
  onChange?: (status: DeviceServerStatus) => void;
  trace?: (line: string) => void;
}

/** How many ports above the kept one a start tries, when that one is held. */
const SLIDE = 9;

interface Listening {
  server: Server;
  port: number;
  /** What it started on: the kept port, the token, the transport. */
  settings: DeviceSettings;
}

/** What a status is made of, read at the moment it changed. */
interface View {
  state: DeviceServerState;
  error: string | undefined;
  listening: Listening | null;
  launch: Launch | null;
  reached: boolean;
}

/**
 * The server a phone loads the game from. One per process.
 *
 * It starts only when asked — a launch, or the command — and holds what it
 * serves in memory: the current launch, read from the editor's snapshot and
 * the project's files. Free of `electron`, so it runs in a test as it runs in
 * the app.
 */
export class DeviceServer {
  private state: DeviceServerState = 'stopped';
  private error: string | undefined;
  private listening: Listening | null = null;
  /** A start under way, which a second start waits for rather than repeating. */
  private starting: Promise<void> | null = null;
  private current: Launch | null = null;
  /** Counts launches and stops, so a launch can tell it was overtaken while it was prepared. */
  private ticket = 0;
  private reached = false;
  private addresses: ListedAddress[] = [];
  private changes: Promise<void> = Promise.resolve();

  constructor(private readonly options: DeviceServerOptions) {}

  /** What the server is doing now. The addresses are read again: a network can change at any time. */
  status(): Promise<DeviceServerStatus> {
    return this.statusOf(this.view());
  }

  /**
   * Listens, on the kept port or one of the nine above it.
   *
   * A busy port slides for this run only, and the file keeps the one it asked
   * for, so a phone's bookmark works again as soon as that port is free. A
   * failure — no player built, no port left — is the `error` state, not a
   * throw: it is a state the editor shows.
   */
  async start(): Promise<DeviceServerStatus> {
    if (this.listening === null) {
      this.starting ??= this.listen().finally(() => {
        this.starting = null;
      });
      await this.starting;
    }
    return this.status();
  }

  /**
   * Closes the server, every connection with it, and forgets the launch.
   *
   * The connections too: a phone holds a keep-alive connection open, and
   * `close` alone would wait for it — and keep the port — until it timed out.
   * A server started again serves the waiting page until the next launch.
   */
  async stop(): Promise<DeviceServerStatus> {
    // A launch still being prepared is dropped, as a newer one would drop it.
    this.ticket += 1;
    if (this.starting !== null) await this.starting;
    const { listening, current, state } = this;
    this.listening = null;
    this.current = null;
    this.state = 'stopped';
    this.error = undefined;
    if (listening !== null) {
      await closeServer(listening.server);
      this.trace('stopped');
    }
    if (listening !== null || current !== null || state !== 'stopped') this.emit();
    return this.status();
  }

  /**
   * Makes a launch from the editor's snapshot, then serves it.
   *
   * Prepared before the server starts, so that scripts that do not compile
   * refuse the launch and leave the server as it was. A newer launch, or a
   * stop, made while this one was prepared drops it: what devices run is
   * always the last thing asked for.
   */
  async launch(projectPath: string, snapshot: LaunchSnapshot): Promise<DeviceServerStatus> {
    const ticket = (this.ticket += 1);
    const prepared = await prepareLaunch(projectPath, snapshot);
    if (ticket !== this.ticket) return this.status();
    await this.start();
    if (ticket !== this.ticket) return this.status();
    if (this.listening === null) throw new Error(this.error ?? 'The device server did not start.');
    this.current = prepared;
    this.trace(`launched "${prepared.sceneName}"`);
    this.emit();
    return this.status();
  }

  private async listen(): Promise<void> {
    this.state = 'starting';
    this.error = undefined;
    this.emit();
    try {
      const settings = await ensureDeviceSettings(this.options.settingsFile);
      const templateDir = await findTemplate(this.options.templateRoots);
      const handler = createDeviceHandler({
        token: settings.token,
        templateDir,
        launch: () => this.current,
        isOwnHost: (host) => this.isOwnHost(host),
        onRequest: (remote) => this.noteRequest(remote),
        trace: this.options.trace,
      });
      const { server, port } = await this.listenFrom(settings.port, handler);
      this.listening = { server, port, settings };
      this.state = 'running';
      this.trace(
        port === settings.port
          ? `started on port ${port}`
          : `started on port ${port}: ${settings.port} is in use`,
      );
    } catch (cause) {
      this.state = 'error';
      this.error = cause instanceof Error ? cause.message : String(cause);
      this.trace(`could not start: ${this.error}`);
    }
    this.emit();
  }

  /** The first of the kept port and the nine above it that is free. */
  private async listenFrom(
    port: number,
    handler: DeviceRequestHandler,
  ): Promise<{ server: Server; port: number }> {
    const last = Math.min(port + SLIDE, 65535);
    for (let candidate = port; candidate <= last; candidate += 1) {
      const server = createServer(handler);
      try {
        await listenOn(server, candidate, this.options.listenHost);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'EADDRINUSE') continue;
        throw cause;
      }
      // Once listening, an error is a broken socket rather than a refusal, and
      // an `error` event nobody listens to would take the main process down.
      server.on('error', (error) => this.trace(`server error: ${error.message}`));
      return { server, port: candidate };
    }
    throw new Error(`Ports ${port} to ${last} are all in use.`);
  }

  /**
   * Whether a request's `Host` names this machine. The addresses are read
   * again before saying no: a new Wi-Fi or a new lease changes them under a
   * running server, and a phone on the new network would be refused.
   */
  private isOwnHost(host: string | undefined): boolean {
    if (isOwnHost(host, this.addresses, hostname())) return true;
    this.addresses = listAddresses(networkInterfaces());
    return isOwnHost(host, this.addresses, hostname());
  }

  private noteRequest(remote: string | undefined): void {
    if (this.reached || !isFromOutside(remote, this.addresses)) return;
    // This machine's address on a network it has just joined is not outside.
    this.addresses = listAddresses(networkInterfaces());
    if (!isFromOutside(remote, this.addresses)) return;
    this.reached = true;
    this.trace(`reached from ${plainAddress(remote ?? '')}`);
    this.emit();
  }

  private view(): View {
    return {
      state: this.state,
      error: this.error,
      listening: this.listening,
      launch: this.current,
      reached: this.reached,
    };
  }

  private async statusOf(view: View): Promise<DeviceServerStatus> {
    this.addresses = listAddresses(networkInterfaces());
    const launch =
      view.launch === null
        ? null
        : { id: view.launch.id, at: view.launch.at, sceneName: view.launch.sceneName };
    const common = {
      state: view.state,
      ...(view.error === undefined ? {} : { error: view.error }),
      launch,
      reachedFromNetwork: view.reached,
    };
    if (view.listening === null) {
      const settings = await readDeviceSettings(this.options.settingsFile);
      return {
        ...common,
        transport: settings.transport,
        port: settings.port,
        requestedPort: settings.port,
        urls: [],
        selectedUrl: null,
      };
    }
    const { port, settings } = view.listening;
    const urls = deviceUrls(this.addresses, settings.transport, port, settings.token);
    return {
      ...common,
      transport: settings.transport,
      port,
      requestedPort: settings.port,
      urls,
      selectedUrl: selectedUrl(urls),
    };
  }

  /**
   * Hands the status as it is now to `onChange`, after every one before it.
   *
   * What changed is read at once; only the settings of a server that is not
   * running are read from disk, in turn. Two changes in a row therefore arrive
   * in order and each as it was, rather than both as the last.
   */
  private emit(): void {
    const onChange = this.options.onChange;
    if (onChange === undefined) return;
    const view = this.view();
    this.changes = this.changes
      .then(async () => onChange(await this.statusOf(view)))
      .catch((cause: unknown) => this.trace(`status not sent: ${String(cause)}`));
  }

  private trace(line: string): void {
    this.options.trace?.(line);
  }
}

function listenOn(server: Server, port: number, host: string | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const failed = (error: Error): void => {
      server.off('listening', listening);
      reject(error);
    };
    const listening = (): void => {
      server.off('error', failed);
      resolve();
    };
    server.once('error', failed);
    server.once('listening', listening);
    server.listen({ port, host });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}
