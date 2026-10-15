import {
  DEVICE_FORGET_MS,
  DEVICE_LIMIT,
  DEVICE_PING_MS,
  DEVICE_PROTOCOL_VERSION,
  DEVICE_RATE,
  DEVICE_RETRY_MS,
  DEVICE_SILENCE_MS,
  DEVICE_STREAMS_PER_DEVICE,
  conformHello,
  conformStatusReport,
  describeUserAgent,
  isDeviceId,
  type DeviceHello,
  type DeviceInfo,
  type DeviceStatusReport,
  type ServerMessage,
} from '@three-studio/core';

/*
 * The server's side of the link with each device: who is there, what each
 * page runs, and the streams the server talks to them on.
 *
 * Free of `electron` and of HTTP — a stream is anything that can be written
 * to and ended, a message the body a device posted — so that every rule here
 * is tested without a socket. `routes.ts` is where requests become calls.
 */

/** An event stream, as the link writes to it. */
export interface DeviceStream {
  write: (text: string) => void;
  end: () => void;
}

export interface DeviceLinkOptions {
  /** The launch a device should run, or `null` before the first. */
  currentLaunch: () => string | null;
  /** A row changed: a device came, went, or said something new. */
  onChange: () => void;
  trace?: (line: string) => void;
  now?: () => number;
}

/** What became of a message: kept, dropped without a word, or refused for its rate. */
export type DeviceReceipt = 'applied' | 'ignored' | 'limited';

interface OpenStream {
  stream: DeviceStream;
  /** The token it was opened with: a new link ends every stream opened with another. */
  token: string;
}

interface Entry {
  id: string;
  streams: OpenStream[];
  /** Where its last stream came from. */
  address: string;
  /** `null` until its first hello: a device is listed once it says who it is. */
  info: Omit<DeviceInfo, 'connected'> | null;
  /** When it first said hello, to list devices in that order. */
  order: number;
  /** When it was last heard from: a stream opened, or a message posted. */
  heard: number;
  /** Since when it has had no stream, while it is listed as offline. */
  offlineSince: number | null;
  /** When it posted, within the last rate window. */
  posts: number[];
}

/** How often the silence and forgetting rules are checked. */
const CHECK_MS = 5_000;

const BACKEND_NAMES = { webgpu: 'WebGPU', webgl: 'WebGL2' } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function line(message: ServerMessage): string {
  return `data: ${JSON.stringify(message)}\n\n`;
}

/** A state as the trace says it: `running on WebGL2`, `failed: <error>`. */
function describeState(info: Pick<DeviceInfo, 'state' | 'backend' | 'error'>): string {
  if (info.state === 'running' && info.backend !== null) {
    return `running on ${BACKEND_NAMES[info.backend]}`;
  }
  if (info.state === 'failed' && info.error !== null) return `failed: ${info.error}`;
  return info.state;
}

export class DeviceLink {
  private readonly entries = new Map<string, Entry>();
  private helloCount = 0;
  private readonly timers: ReturnType<typeof setInterval>[];

  /** Starts the link's own clock — the pings and the silence rules — which `stop` ends. */
  constructor(private readonly options: DeviceLinkOptions) {
    this.timers = [
      setInterval(() => this.ping(), DEVICE_PING_MS),
      setInterval(() => this.check(), CHECK_MS),
    ];
    // Never what keeps the app alive: a quit must not wait for the next ping.
    for (const timer of this.timers) timer.unref?.();
  }

  /**
   * Takes a device's stream, or refuses it with `null`: past 32 devices, or
   * past four streams for this one. Returns what to call when the request
   * that holds the stream closes.
   *
   * A device is a browser, not a tab, so its tabs share an id and may each
   * hold a stream. A fifth is refused rather than let in at the expense of an
   * older one: two tabs that reconnect in turn would otherwise evict each
   * other forever.
   */
  open({
    device,
    token,
    address,
    stream,
  }: {
    device: string;
    token: string;
    address: string;
    stream: DeviceStream;
  }): (() => void) | null {
    let entry = this.entries.get(device);
    if (entry === undefined) {
      if (this.entries.size >= DEVICE_LIMIT) return null;
      entry = {
        id: device,
        streams: [],
        address,
        info: null,
        order: 0,
        heard: this.now(),
        offlineSince: null,
        posts: [],
      };
      this.entries.set(device, entry);
    } else if (entry.streams.length >= DEVICE_STREAMS_PER_DEVICE) {
      return null;
    }
    const opened: OpenStream = { stream, token };
    const known = entry;
    this.changing(() => {
      known.streams.push(opened);
      known.address = address;
      known.heard = this.now();
      known.offlineSince = null;
      if (known.info !== null) known.info = { ...known.info, address };
    });
    stream.write(`retry: ${DEVICE_RETRY_MS}\n\n`);
    return () => this.closed(known, opened);
  }

  /**
   * A message a device posted. Ignored — not refused — when it comes from no
   * device with a stream, when it is malformed, or of a type this build does
   * not know: a newer client talks to an older editor, and a phone with no
   * stream is told nothing either way.
   */
  receive(type: string, body: unknown): DeviceReceipt {
    const device = isRecord(body) ? body['device'] : undefined;
    const entry = isDeviceId(device) ? this.entries.get(device) : undefined;
    if (entry === undefined || entry.streams.length === 0) return 'ignored';
    if (!this.withinRate(entry)) return 'limited';
    entry.heard = this.now();
    switch (type) {
      case 'hello':
        return this.hello(entry, conformHello(body));
      case 'status':
        return this.status(entry, conformStatusReport(body));
      default:
        return 'ignored';
    }
  }

  /** Restarts every connected device on a new launch. Returns how many were told. */
  launch(id: string): number {
    let told = 0;
    this.changing(() => {
      for (const entry of this.entries.values()) {
        if (this.tell(entry, id)) told += 1;
      }
    });
    return told;
  }

  /** Restarts one device on the launch given. `false` when it has no stream to be told on. */
  restart(device: string, launchId: string): boolean {
    const entry = this.entries.get(device);
    if (entry === undefined) return false;
    let told = false;
    this.changing(() => {
      told = this.tell(entry, launchId);
    });
    return told;
  }

  /**
   * Tells every device that the editor stopped serving, then ends every
   * stream and forgets every device.
   *
   * Told first, so that a page can say the editor stopped rather than that
   * the network failed. Says nothing to `onChange`: the server reports its own
   * stop, and a status in between would show it still running with nobody.
   */
  stop(): void {
    for (const timer of this.timers) clearInterval(timer);
    const stopped = line({ v: DEVICE_PROTOCOL_VERSION, type: 'stopped' });
    for (const entry of this.entries.values()) {
      for (const { stream } of entry.streams) {
        stream.write(stopped);
        stream.end();
      }
    }
    this.entries.clear();
  }

  /**
   * Ends every stream opened with another token, and forgets a device left
   * with none. The token is checked when a request begins, and a stream
   * outlives that check: without this, a phone that had the old link would
   * keep hearing launches after a new link was made to shut it out.
   */
  closeOpenedWithout(token: string): void {
    this.changing(() => {
      for (const entry of [...this.entries.values()]) {
        const kept = entry.streams.filter((opened) => opened.token === token);
        if (kept.length === entry.streams.length) continue;
        for (const opened of entry.streams) {
          if (opened.token !== token) opened.stream.end();
        }
        entry.streams = kept;
        if (kept.length === 0) {
          this.entries.delete(entry.id);
          this.trace(`${entry.id} forgotten: it had the old link`);
        }
      }
    });
  }

  /** Every device that said hello, connected or not, in the order they first did. */
  list(): DeviceInfo[] {
    return [...this.entries.values()]
      .filter((entry): entry is Entry & { info: NonNullable<Entry['info']> } => entry.info !== null)
      .sort((a, b) => a.order - b.order)
      .map((entry) => ({ ...entry.info, connected: entry.streams.length > 0 }));
  }

  private hello(entry: Entry, hello: DeviceHello | null): DeviceReceipt {
    if (hello === null) return 'ignored';
    const current = this.options.currentLaunch();
    // A page on another launch — the waiting page, or one left open over a
    // launch it slept through — restarts on the current one: its hello is
    // how a launch made meanwhile reaches it.
    const restartOn = current !== null && hello.launch !== current ? current : null;
    this.changing(() => {
      if (entry.info === null) {
        entry.order = this.helloCount;
        this.helloCount += 1;
      }
      entry.info = {
        id: entry.id,
        ...describeUserAgent(hello.userAgent),
        userAgent: hello.userAgent,
        address: entry.address,
        screen: hello.screen,
        secureContext: hello.secureContext,
        launch: hello.launch,
        state: hello.state,
        backend: hello.backend,
        error: hello.error,
      };
      if (restartOn !== null) this.tell(entry, restartOn);
    });
    const { name, browser } = describeUserAgent(hello.userAgent);
    this.trace(
      `${entry.id} said hello: ${name} · ${browser} from ${entry.address}, ${describeState(hello)}`,
    );
    if (restartOn !== null) this.trace(`${entry.id} told to restart on the current launch`);
    return 'applied';
  }

  private status(entry: Entry, report: DeviceStatusReport | null): DeviceReceipt {
    const info = entry.info;
    if (report === null || info === null) return 'ignored';
    const { state, backend, error } = report;
    if (info.state === state && info.backend === backend && info.error === error) return 'applied';
    this.changing(() => {
      entry.info = { ...info, state, backend, error };
    });
    this.trace(`${entry.id} ${describeState(report)}`);
    return 'applied';
  }

  /** Sends a launch down every stream of a device, which turns booting. `false` with no stream. */
  private tell(entry: Entry, launchId: string): boolean {
    if (entry.streams.length === 0) return false;
    const message = line({ v: DEVICE_PROTOCOL_VERSION, type: 'launch', launch: launchId });
    for (const { stream } of entry.streams) stream.write(message);
    if (entry.info !== null) entry.info = { ...entry.info, state: 'booting' };
    return true;
  }

  private ping(): void {
    const ping = line({ v: DEVICE_PROTOCOL_VERSION, type: 'ping' });
    for (const entry of this.entries.values()) {
      for (const { stream } of entry.streams) stream.write(ping);
    }
  }

  /**
   * Ends the streams of a device that has said nothing for a minute, and
   * forgets a device that has had no stream for half of one. A phone that
   * leaves the Wi-Fi does not close its connection, and TCP gives up on it
   * only after minutes: until then it would be listed as connected.
   */
  private check(): void {
    const now = this.now();
    this.changing(() => {
      for (const entry of [...this.entries.values()]) {
        if (entry.streams.length > 0) {
          if (now - entry.heard < DEVICE_SILENCE_MS) continue;
          for (const { stream } of entry.streams) stream.end();
          entry.streams = [];
          this.trace(`${entry.id} went silent`);
          this.disconnected(entry, now);
        } else if (entry.offlineSince !== null && now - entry.offlineSince >= DEVICE_FORGET_MS) {
          this.entries.delete(entry.id);
          this.trace(`${entry.id} gone`);
        }
      }
    });
  }

  /** The request holding a stream closed: the phone went, or the server ended it. */
  private closed(entry: Entry, opened: OpenStream): void {
    const index = entry.streams.indexOf(opened);
    if (index === -1) return;
    this.changing(() => {
      entry.streams.splice(index, 1);
      if (entry.streams.length === 0) this.disconnected(entry, this.now());
    });
  }

  /** A device left with no stream: listed as offline for a while, or dropped if it never said hello. */
  private disconnected(entry: Entry, now: number): void {
    if (entry.info === null) {
      if (this.entries.get(entry.id) === entry) this.entries.delete(entry.id);
      return;
    }
    entry.offlineSince = now;
  }

  private withinRate(entry: Entry): boolean {
    const now = this.now();
    entry.posts = entry.posts.filter((at) => now - at < DEVICE_RATE.perMs);
    if (entry.posts.length >= DEVICE_RATE.messages) return false;
    entry.posts.push(now);
    return true;
  }

  /** Runs a change, and tells `onChange` only when a row reads differently after it. */
  private changing(change: () => void): void {
    const before = JSON.stringify(this.list());
    change();
    if (JSON.stringify(this.list()) !== before) this.options.onChange();
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private trace(text: string): void {
    this.options.trace?.(text);
  }
}
