import { createServer, type Server } from 'node:http';
import { hostname, networkInterfaces } from 'node:os';
import { basename } from 'node:path';
import {
  createDeviceToken,
  type DeviceInfo,
  type DeviceServerState,
  type DeviceServerStatus,
  type DeviceSettings,
  type DeviceSettingsPatch,
  type LaunchSnapshot,
  type PortHolder,
} from '@three-studio/core';
import { findDeviceClient, findTemplate } from '../prebuilt';
import {
  deviceUrls,
  isFromOutside,
  isOwnHost,
  listAddresses,
  plainAddress,
  selectedUrl,
  type ListedAddress,
} from './addresses';
import { DeviceLink } from './deviceLink';
import { prepareLaunch, type Launch } from './launch';
import { portHolderOf } from './portHolder';
import { createDeviceHandler, type DeviceRequestHandler } from './routes';
import {
  ensureDeviceSettings,
  readDeviceSettings,
  updateDeviceSettings,
} from './settingsFile';

export interface DeviceServerOptions {
  /** `devices.json`, in the app's data directory. */
  settingsFile: string;
  /** Where to look for the prebuilt player, as the exporter looks, and for the device client beside it. */
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

/** How often taking the port back tries it, once its holder was asked to quit. */
const RETRY_MS = 200;
/** How long a holder has to quit when asked, before it is made to. */
const GRACE_MS = 3000;
/** How long the port may stay held after that, before taking it back gives up. */
const GIVE_UP_MS = 2000;

/** Asks the person whether another Three Studio, holding that port, may be quit. */
export type ConfirmQuit = (holder: PortHolder, port: number) => Promise<boolean>;

interface Listening {
  server: Server;
  port: number;
  /**
   * What it serves under — the kept port, the token, the transport — and the
   * address its link is made of.
   */
  settings: DeviceSettings;
  /** Kept so that a server moved to another port answers exactly as before. */
  handler: DeviceRequestHandler;
  /** The link with each device, for as long as this server runs: a stop forgets them all. */
  link: DeviceLink;
}

/** What a status is made of, read at the moment it changed. */
interface View {
  state: DeviceServerState;
  error: string | undefined;
  listening: Listening | null;
  holder: PortHolder | null;
  launch: Launch | null;
  reached: boolean;
  devices: DeviceInfo[];
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
  /** Who holds the kept port, while the server runs on another. */
  private holder: PortHolder | null = null;
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
   * Closes the server, every connection with it, and forgets the launch and
   * every device.
   *
   * Each device is told first, on its stream, so that its page can say the
   * editor stopped rather than that the network failed — a quit may cut that
   * short, and the page then keeps trying as it would on any lost network. The
   * connections too: a phone holds a keep-alive connection open, and `close`
   * alone would wait for it — and keep the port — until it timed out. A server
   * started again serves the waiting page until the next launch.
   */
  async stop(): Promise<DeviceServerStatus> {
    // A launch still being prepared is dropped, as a newer one would drop it.
    this.ticket += 1;
    if (this.starting !== null) await this.starting;
    const { listening, current, state } = this;
    this.listening = null;
    this.holder = null;
    this.current = null;
    this.state = 'stopped';
    this.error = undefined;
    if (listening !== null) {
      listening.link.stop();
      await closeServer(listening.server);
      this.trace('stopped');
    }
    if (listening !== null || current !== null || state !== 'stopped') this.emit();
    return this.status();
  }

  /**
   * Makes a launch from the editor's snapshot, then serves it, and restarts
   * every connected device on it.
   *
   * Prepared before the server starts, so that scripts that do not compile
   * refuse the launch and leave the server as it was — and tell no device. A
   * newer launch, or a stop, made while this one was prepared drops it: what
   * devices run is always the last thing asked for.
   */
  async launch(projectPath: string, snapshot: LaunchSnapshot): Promise<DeviceServerStatus> {
    const ticket = (this.ticket += 1);
    const prepared = await prepareLaunch(projectPath, snapshot);
    if (ticket !== this.ticket) return this.status();
    await this.start();
    if (ticket !== this.ticket) return this.status();
    const listening = this.listening;
    if (listening === null) throw new Error(this.error ?? 'The device server did not start.');
    this.current = prepared;
    this.trace(`launched "${prepared.sceneName}"`);
    const told = listening.link.launch(prepared.id);
    this.trace(`launch told to ${told} ${told === 1 ? 'device' : 'devices'}`);
    this.emit();
    return this.status();
  }

  /**
   * Restarts one device on the current launch, without a new snapshot: what
   * the device ran is what it runs again.
   */
  async restart(device: string): Promise<DeviceServerStatus> {
    if (this.starting !== null) await this.starting;
    const { listening, current } = this;
    if (listening === null || current === null) throw new Error('Nothing has been launched yet.');
    if (!listening.link.restart(device, current.id)) {
      throw new Error('That device is not connected.');
    }
    this.trace(`${device} restarted`);
    return this.status();
  }

  private async listen(): Promise<void> {
    this.state = 'starting';
    this.error = undefined;
    this.emit();
    try {
      const settings = await ensureDeviceSettings(this.options.settingsFile);
      const templateDir = await findTemplate(this.options.templateRoots);
      // Refused like a missing player: every page served carries the client,
      // and a page without it is a phone the editor can never restart.
      const clientDir = await findDeviceClient(this.options.templateRoots);
      const link = new DeviceLink({
        currentLaunch: () => this.current?.id ?? null,
        onChange: () => this.emit(),
        trace: this.options.trace,
      });
      const handler = createDeviceHandler({
        token: () => this.listening?.settings.token ?? settings.token,
        templateDir,
        clientDir,
        launch: () => this.current,
        link,
        transport: () => this.listening?.settings.transport ?? settings.transport,
        isOwnHost: (host) => this.isOwnHost(host),
        onRequest: (remote) => this.noteRequest(remote),
        trace: this.options.trace,
      });
      let listened: { server: Server; port: number };
      try {
        listened = await this.listenFrom(settings.port, handler);
      } catch (cause) {
        link.stop();
        throw cause;
      }
      const { server, port } = listened;
      this.listening = { server, port, settings, handler, link };
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
    await this.findHolder();
  }

  /**
   * Writes a change to the settings, and moves a running server onto a port
   * newly chosen — or the next free one above it, as a start would.
   *
   * An address moves nothing: the server listens on every interface already,
   * and the address only decides which link is shown first.
   */
  async saveSettings(patch: DeviceSettingsPatch): Promise<DeviceServerStatus> {
    const saved = await updateDeviceSettings(this.options.settingsFile, patch);
    if (this.starting !== null) await this.starting;
    const listening = this.listening;
    if (listening !== null) {
      const settings = { ...listening.settings, port: saved.port, address: saved.address };
      if (saved.port === listening.settings.port) {
        this.listening = { ...listening, settings };
      } else if (saved.port === listening.port) {
        // Already there, after a slide: the port asked for is now the one held.
        this.listening = { ...listening, settings };
        this.holder = null;
      } else {
        await this.moveTo(saved.port, { slide: true, settings });
      }
    }
    this.emit();
    return this.status();
  }

  /**
   * Makes a new link: a new token, written alone. A running server answers it
   * at once, and refuses the old one from the next request on — which is the
   * point, since this is how a link that leaked is taken back: every link a
   * device saved stops working.
   *
   * The streams opened with the old token are ended too, and their devices
   * forgotten: a stream outlives the check its request passed, and would
   * otherwise go on hearing every launch. Their pages then find the link gone.
   */
  async regenerateToken(): Promise<DeviceServerStatus> {
    // A start in flight reads the file: let it, then replace what it read.
    if (this.starting !== null) await this.starting;
    const saved = await updateDeviceSettings(this.options.settingsFile, {
      token: createDeviceToken(),
    });
    const listening = this.listening;
    if (listening !== null) {
      this.listening = { ...listening, settings: { ...listening.settings, token: saved.token } };
      this.trace('new token');
      listening.link.closeOpenedWithout(saved.token);
    }
    this.emit();
    return this.status();
  }

  /**
   * Moves a server that slid back onto the port the settings keep.
   *
   * When that port came free meanwhile, at once. When another Three Studio —
   * this very executable — holds it, after `confirm`: it is asked to quit,
   * then made to if it has not within a few seconds, and the server moves
   * back once the port is free. Any other holder is named and left alone:
   * this never quits a program it cannot tell is this one.
   *
   * The process id is never taken from the caller, and it is looked up again
   * before each signal: a holder that quit while the dialog was open may have
   * left its id to something else.
   */
  async reclaimPort(confirm: ConfirmQuit): Promise<DeviceServerStatus> {
    if (this.starting !== null) await this.starting;
    const listening = this.listening;
    if (listening === null || listening.port === listening.settings.port) return this.status();
    const kept = listening.settings.port;
    if (await this.moveTo(kept)) return this.status();

    const holder = await portHolderOf(kept);
    this.holder = holder;
    this.emit();
    if (holder === null || !holder.sameApp) {
      throw new Error(
        `Port ${kept} is held by ${describeHolder(holder)}, which Three Studio will not quit.`,
      );
    }
    if (!(await confirm(holder, kept))) return this.status();

    if (!(await this.signalIfHolding(kept, holder.pid, 'SIGTERM'))) {
      // It went while the dialog was open, or something else took its place,
      // which nobody agreed to quit.
      if (await this.moveTo(kept)) return this.status();
      throw new Error(`Port ${kept} is now held by ${describeHolder(await portHolderOf(kept))}.`);
    }
    if (await this.retryMove(kept, GRACE_MS)) return this.status();
    await this.signalIfHolding(kept, holder.pid, 'SIGKILL');
    if (await this.retryMove(kept, GIVE_UP_MS)) return this.status();
    throw new Error(`Port ${kept} is still in use.`);
  }

  /** Sends a signal, only if that same process still holds the port. */
  private async signalIfHolding(
    port: number,
    pid: number,
    signal: NodeJS.Signals,
  ): Promise<boolean> {
    if ((await portHolderOf(port))?.pid !== pid) return false;
    try {
      process.kill(pid, signal);
      this.trace(`sent ${signal} to process ${pid}, which held port ${port}`);
      return true;
    } catch {
      // Gone between the look and the signal: what matters is the port.
      return false;
    }
  }

  /** Tries to move onto a port until it is free, or the time is up. */
  private async retryMove(port: number, during: number): Promise<boolean> {
    const until = Date.now() + during;
    while (Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
      if (this.listening === null) return true;
      if (await this.moveTo(port)) return true;
    }
    return false;
  }

  /**
   * Listens anew on a port with the same handler, then closes the old server,
   * so that a device's next request finds the same launch on the new port.
   * `false` when the port is held, unless sliding was asked for.
   */
  private async moveTo(
    target: number,
    { slide = false, settings }: { slide?: boolean; settings?: DeviceSettings } = {},
  ): Promise<boolean> {
    const listening = this.listening;
    if (listening === null) return false;
    let moved: { server: Server; port: number };
    if (slide) {
      moved = await this.listenFrom(target, listening.handler);
    } else {
      const server = await this.tryListen(target, listening.handler);
      if (server === null) return false;
      moved = { server, port: target };
    }
    this.listening = { ...listening, ...moved, settings: settings ?? listening.settings };
    await closeServer(listening.server);
    this.trace(`moved to port ${moved.port}`);
    this.holder = null;
    this.emit();
    await this.findHolder();
    return true;
  }

  /** After a slide, who holds the kept port: what the editor names, and may offer to quit. */
  private async findHolder(): Promise<void> {
    const listening = this.listening;
    if (listening === null || listening.port === listening.settings.port) return;
    const holder = await portHolderOf(listening.settings.port);
    if (this.listening !== listening) return;
    this.holder = holder;
    if (holder !== null) {
      this.trace(`port ${listening.settings.port} is held by ${describeHolder(holder)}`);
      this.emit();
    }
  }

  /** The first of the kept port and the nine above it that is free. */
  private async listenFrom(
    port: number,
    handler: DeviceRequestHandler,
  ): Promise<{ server: Server; port: number }> {
    const last = Math.min(port + SLIDE, 65535);
    for (let candidate = port; candidate <= last; candidate += 1) {
      const server = await this.tryListen(candidate, handler);
      if (server !== null) return { server, port: candidate };
    }
    throw new Error(`Ports ${port} to ${last} are all in use.`);
  }

  /** A server listening on that port, or `null` when something else holds it. */
  private async tryListen(port: number, handler: DeviceRequestHandler): Promise<Server | null> {
    const server = createServer(handler);
    try {
      await listenOn(server, port, this.options.listenHost);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'EADDRINUSE') return null;
      throw cause;
    }
    // Once listening, an error is a broken socket rather than a refusal, and
    // an `error` event nobody listens to would take the main process down.
    server.on('error', (error) => this.trace(`server error: ${error.message}`));
    return server;
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
      holder: this.holder,
      launch: this.current,
      reached: this.reached,
      devices: this.listening?.link.list() ?? [],
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
      portHolder: view.holder,
      launch,
      reachedFromNetwork: view.reached,
      devices: view.devices,
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
        address: settings.address,
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
      selectedUrl: selectedUrl(urls, settings.address),
      address: settings.address,
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

/** A holder as a sentence names it: `node (process 4242)`. */
function describeHolder(holder: PortHolder | null): string {
  if (holder === null) return 'another program';
  const name = holder.program === null ? 'a program' : basename(holder.program);
  return `${name} (process ${holder.pid})`;
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
