import {
  DEVICE_FORGET_MS,
  DEVICE_LIMIT,
  DEVICE_LOG_RATE,
  DEVICE_PING_MS,
  DEVICE_PROTOCOL_VERSION,
  DEVICE_RATE,
  DEVICE_RETRY_MS,
  DEVICE_SCREENSHOT_RATE,
  DEVICE_SCREENSHOT_WAIT_MS,
  DEVICE_SILENCE_MS,
  DEVICE_STATS_RATE,
  DEVICE_STREAMS_PER_DEVICE,
  conformHello,
  conformLogMessage,
  conformStatsReport,
  conformStatusReport,
  createId,
  describeUserAgent,
  deviceLabel,
  isDeviceId,
  type DeviceHello,
  type DeviceInfo,
  type DeviceLogMessage,
  type DeviceLogs,
  type DeviceStatsReport,
  type DeviceStatusReport,
  type DeviceTransport,
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
  /**
   * What each page draws for itself, as the launch options say: written as
   * each stream opens, so that a page that loads — a restart, a page back
   * from sleep — draws as the others do without being told again.
   */
  clientOptions: () => { stats: boolean };
  /** A row changed: a device came, went, or said something new. */
  onChange: () => void;
  /** A device's lines, with its name and browser as they are when the lines arrive. */
  onLog?: (logs: DeviceLogs) => void;
  trace?: (line: string) => void;
  now?: () => number;
}

/** What became of a message: kept, dropped without a word, or refused for its rate. */
export type DeviceReceipt = 'applied' | 'ignored' | 'limited';

/** A device's frame, as its upload brought it: the PNG's bytes, and the size its header says. */
export interface DeviceFrame {
  bytes: Uint8Array;
  width: number;
  height: number;
}

/**
 * What the route settles a screenshot request with, once it reads the upload
 * that answers it. The first call settles it; any after that does nothing.
 */
export interface ScreenshotUpload {
  /** The device, as its row says it, for the words of a refusal. */
  label: string;
  accept: (bytes: Uint8Array, size: { width: number; height: number }) => void;
  refuse: (message: string) => void;
}

/**
 * The rates a device's messages are counted against, each apart from the
 * others: a game that logs every frame must never spend the hellos and
 * statuses that keep its row alive — a heartbeat refused long enough is a
 * device ended for silence — and neither must its stats. Screenshots are
 * counted where the server asks for them, since a request is what makes a
 * phone copy and encode its canvas.
 */
const RATES = {
  link: DEVICE_RATE,
  log: DEVICE_LOG_RATE,
  stats: DEVICE_STATS_RATE,
  screenshot: DEVICE_SCREENSHOT_RATE,
} as const;

type RateKind = keyof typeof RATES;

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
  /** When it posted — or, for screenshots, was asked — within the last window of each rate. */
  posts: Record<RateKind, number[]>;
}

/** A frame asked of a device, until its upload is accepted or refused, or the request ends. */
interface PendingScreenshot {
  /** Its id, `createId(16)`: the one permission an upload carries beside the token. */
  request: string;
  device: string;
  label: string;
  promise: Promise<DeviceFrame>;
  resolve: (frame: DeviceFrame) => void;
  reject: (error: Error) => void;
  /** Gives up on an upload that has not begun; cleared once one has. */
  timer: ReturnType<typeof setTimeout> | null;
  /** An upload has begun: the route reads it, and no other may answer. */
  receiving: boolean;
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
  /** By request id: an upload names its request, not its device. */
  private readonly screenshots = new Map<string, PendingScreenshot>();
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
        posts: { link: [], log: [], stats: [], screenshot: [] },
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
    stream.write(this.optionsLine());
    return () => this.closed(known, opened);
  }

  /**
   * A message a device posted. Ignored — not refused — when it comes from no
   * device with a stream, when it is malformed, or of a type this build does
   * not know: a newer client talks to an older editor, and a phone with no
   * stream is told nothing either way. A type it does not know spends no
   * rate, so that what a newer client sends never starves the link.
   */
  receive(type: string, body: unknown): DeviceReceipt {
    const device = isRecord(body) ? body['device'] : undefined;
    const entry = isDeviceId(device) ? this.entries.get(device) : undefined;
    if (entry === undefined || entry.streams.length === 0) return 'ignored';
    switch (type) {
      case 'hello':
      case 'status':
        if (!this.withinRate(entry, 'link')) return 'limited';
        entry.heard = this.now();
        return type === 'hello'
          ? this.hello(entry, conformHello(body))
          : this.status(entry, conformStatusReport(body));
      case 'log':
        return this.log(entry, conformLogMessage(body));
      case 'stats':
        return this.stats(entry, conformStatsReport(body));
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

  /**
   * Tells every stream what its page draws for itself, as the launch options
   * now say. Returns how many devices were told. No row reads differently:
   * what a page draws is not shown in one.
   */
  sendOptions(): number {
    const options = this.optionsLine();
    let told = 0;
    for (const entry of this.entries.values()) {
      if (entry.streams.length === 0) continue;
      for (const { stream } of entry.streams) stream.write(options);
      told += 1;
    }
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
   * Asks a device for the next frame its player draws, and resolves once the
   * route has taken the upload that answers.
   *
   * The request is written to every stream of the device, since its tabs share
   * its id and only a visible one can answer. One request per device at a
   * time: asked again meanwhile, the device is not asked twice, and both get
   * the same frame. An upload must begin within `DEVICE_SCREENSHOT_WAIT_MS`;
   * once begun it is the route's to time, since a large frame on a slow
   * Wi-Fi may take longer than that to arrive.
   */
  requestScreenshot(device: string): Promise<DeviceFrame> {
    const entry = this.entries.get(device);
    if (entry === undefined || entry.streams.length === 0 || entry.info === null) {
      return Promise.reject(new Error('That device is not connected.'));
    }
    const asked = this.screenshotOf(device);
    if (asked !== undefined) return asked.promise;
    const label = deviceLabel(entry.info);
    if (!this.withinRate(entry, 'screenshot')) {
      return Promise.reject(new Error(`Too many screenshots from ${label}: wait a few seconds.`));
    }
    let resolve!: (frame: DeviceFrame) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<DeviceFrame>((resolved, rejected) => {
      resolve = resolved;
      reject = rejected;
    });
    const screenshot: PendingScreenshot = {
      request: createId(16),
      device,
      label,
      promise,
      resolve,
      reject,
      timer: null,
      receiving: false,
    };
    const seconds = DEVICE_SCREENSHOT_WAIT_MS / 1000;
    screenshot.timer = setTimeout(
      () =>
        this.refuseScreenshot(
          screenshot,
          `No frame came back from ${label} within ${seconds} s. Is the game in front on the device?`,
        ),
      DEVICE_SCREENSHOT_WAIT_MS,
    );
    screenshot.timer.unref?.();
    this.screenshots.set(screenshot.request, screenshot);
    const message = line({
      v: DEVICE_PROTOCOL_VERSION,
      type: 'screenshot',
      request: screenshot.request,
    });
    for (const { stream } of entry.streams) stream.write(message);
    this.trace(`screenshot asked of ${label}`);
    return promise;
  }

  /**
   * The request an upload names, for the route to read the upload and settle
   * the request with — or `null` when it names none still waiting, or one whose
   * upload has already begun: an upload is read only when it answers a request
   * the server made, and only one upload answers it.
   */
  screenshotUpload(request: string): ScreenshotUpload | null {
    const screenshot = this.screenshots.get(request);
    if (screenshot === undefined || screenshot.receiving) return null;
    screenshot.receiving = true;
    if (screenshot.timer !== null) clearTimeout(screenshot.timer);
    screenshot.timer = null;
    return {
      label: screenshot.label,
      accept: (bytes, { width, height }) => {
        if (!this.settled(screenshot)) return;
        this.trace(`screenshot from ${screenshot.label}: ${width}×${height}, ${bytes.length} bytes`);
        screenshot.resolve({ bytes, width, height });
      },
      refuse: (message) => this.refuseScreenshot(screenshot, message),
    };
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
    this.endScreenshots((label) => `The device server stopped before ${label} sent its frame.`);
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
   * Tells every device to open its page again under the other scheme, then
   * ends every stream and forgets every device, while the link itself goes on.
   *
   * The server is about to listen again on the same port, and none of the old
   * server's connections survive it. Each page comes back on another origin,
   * whose storage holds another device id: the rows it had would be nobody's.
   */
  reopen(transport: DeviceTransport): void {
    const reopen = line({ v: DEVICE_PROTOCOL_VERSION, type: 'reopen', transport });
    const scheme = transport.toUpperCase();
    this.endScreenshots((label) => `${label} moved to ${scheme} before sending its frame.`);
    this.changing(() => {
      for (const entry of this.entries.values()) {
        for (const { stream } of entry.streams) {
          stream.write(reopen);
          stream.end();
        }
      }
      this.entries.clear();
    });
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
          this.endScreenshot(
            entry.id,
            (label) => `The device link was renewed before ${label} sent its frame.`,
          );
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
    const reloads = (entry.info?.reloads ?? 0) + (hello.reloaded ? 1 : 0);
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
        // A new page, or a new stream: either way, what was measured before
        // was another page's, or another moment's.
        stats: null,
        // The device's, not the page's: the page that died is the one that
        // would have counted it.
        reloads,
      };
      if (restartOn !== null) this.tell(entry, restartOn);
    });
    const label = deviceLabel(describeUserAgent(hello.userAgent));
    this.trace(`${entry.id} said hello: ${label} from ${entry.address}, ${describeState(hello)}`);
    if (hello.reloaded) this.trace(`${label} was reloaded by its browser`);
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

  /**
   * A batch of lines, handed on with the device's name and browser as they
   * are now: the device may leave the list before a window reads them. Never
   * a change of row, since a row shows no line, and never in the trace,
   * which says only that lines were lost or refused: the lines are the
   * Console's.
   *
   * Ignored, and spending no rate, when its page ran another launch than the
   * current one. Each launch takes the devices' lines out of every Console, and
   * a page sends what it still holds as it goes — a batch that arrives once
   * the next launch is current, and would bring back a run that left.
   */
  private log(entry: Entry, message: DeviceLogMessage | null): DeviceReceipt {
    const info = entry.info;
    if (message === null || info === null) return 'ignored';
    if (message.launch !== this.options.currentLaunch()) return 'ignored';
    if (!this.withinRate(entry, 'log')) {
      this.trace(`${entry.id} sent lines too fast: a batch was refused`);
      return 'limited';
    }
    entry.heard = this.now();
    const { lines, dropped } = message;
    if (dropped > 0) {
      this.trace(`${entry.id} lost ${dropped} ${dropped === 1 ? 'line' : 'lines'} on the way`);
    }
    if (lines.length > 0 || dropped > 0) {
      const { name, browser } = info;
      this.options.onLog?.({ device: entry.id, name, browser, lines, dropped });
    }
    return 'applied';
  }

  /**
   * A page's stats, kept on its device's row until the next report — or until
   * the page is replaced: they are emptied whenever the device is told to
   * restart, says hello, or loses its last stream, so a row never shows one
   * build's numbers under another.
   *
   * Ignored, and spending no rate, from a page on another launch than the
   * current one: a report that arrives once the next launch is current
   * measured a page already replaced.
   */
  private stats(entry: Entry, report: DeviceStatsReport | null): DeviceReceipt {
    const info = entry.info;
    if (report === null || info === null) return 'ignored';
    if (report.launch !== this.options.currentLaunch()) return 'ignored';
    if (!this.withinRate(entry, 'stats')) return 'limited';
    entry.heard = this.now();
    const { v: _v, device: _device, launch: _launch, ...stats } = report;
    const label = deviceLabel(info);
    // A state worth a line, rather than every report: one every two seconds
    // per device would bury the trace.
    if (stats.pinned30 && info.stats?.pinned30 !== true) this.trace(`${label} held at 30 fps`);
    if (!stats.pinned30 && info.stats?.pinned30 === true) {
      this.trace(`${label} no longer held at 30 fps`);
    }
    this.changing(() => {
      entry.info = { ...info, stats };
    });
    return 'applied';
  }

  /** What every stream starts with, and hears again when the launch options change. */
  private optionsLine(): string {
    const { stats } = this.options.clientOptions();
    return line({ v: DEVICE_PROTOCOL_VERSION, type: 'options', stats });
  }

  /**
   * Sends a launch down every stream of a device, which turns booting, its
   * stats emptied for the page that replaces this one, and the frame asked of
   * it given up: the page that would have drawn it is going. `false` with no
   * stream.
   */
  private tell(entry: Entry, launchId: string): boolean {
    if (entry.streams.length === 0) return false;
    const message = line({ v: DEVICE_PROTOCOL_VERSION, type: 'launch', launch: launchId });
    for (const { stream } of entry.streams) stream.write(message);
    if (entry.info !== null) entry.info = { ...entry.info, state: 'booting', stats: null };
    this.endScreenshot(entry.id, (label) => `${label} restarted before sending its frame.`);
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

  /**
   * A device left with no stream: listed as offline for a while, its stats
   * emptied — nothing measures there any more — and the frame asked of it
   * given up; or dropped if it never said hello.
   */
  private disconnected(entry: Entry, now: number): void {
    if (entry.info === null) {
      if (this.entries.get(entry.id) === entry) this.entries.delete(entry.id);
      return;
    }
    entry.info = { ...entry.info, stats: null };
    entry.offlineSince = now;
    this.endScreenshot(entry.id, (label) => `${label} went away before sending its frame.`);
  }

  /** The frame asked of a device and not yet settled, whether or not its upload has begun. */
  private screenshotOf(device: string): PendingScreenshot | undefined {
    for (const screenshot of this.screenshots.values()) {
      if (screenshot.device === device) return screenshot;
    }
    return undefined;
  }

  /**
   * Takes a request out of those waiting, its timer with it. `false` when it
   * was settled already: the first answer is the one that counts.
   */
  private settled(screenshot: PendingScreenshot): boolean {
    if (this.screenshots.get(screenshot.request) !== screenshot) return false;
    this.screenshots.delete(screenshot.request);
    if (screenshot.timer !== null) clearTimeout(screenshot.timer);
    return true;
  }

  private refuseScreenshot(screenshot: PendingScreenshot, reason: string): void {
    if (!this.settled(screenshot)) return;
    this.trace(`screenshot from ${screenshot.label} failed: ${reason}`);
    screenshot.reject(new Error(reason));
  }

  /** Ends the frame asked of a device early, in words that say why. */
  private endScreenshot(device: string, why: (label: string) => string): void {
    const screenshot = this.screenshotOf(device);
    if (screenshot !== undefined) this.refuseScreenshot(screenshot, why(screenshot.label));
  }

  private endScreenshots(why: (label: string) => string): void {
    for (const screenshot of [...this.screenshots.values()]) {
      this.refuseScreenshot(screenshot, why(screenshot.label));
    }
  }

  private withinRate(entry: Entry, kind: RateKind): boolean {
    const { messages, perMs } = RATES[kind];
    const now = this.now();
    const posts = entry.posts[kind].filter((at) => now - at < perMs);
    entry.posts[kind] = posts;
    if (posts.length >= messages) return false;
    posts.push(now);
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
