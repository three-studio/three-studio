/*
 * What a device and the device server say to each other, version 1.
 *
 * The server writes to an event stream the page opens; the page POSTs its own
 * messages back, one JSON body each, to `__studio/<type>` — all but a
 * screenshot, whose body is the PNG itself. No WebSocket: an
 * event stream is plain HTTP, so it goes wherever the page goes — a proxy, a
 * tunnel, HTTPS — and reconnects on its own.
 *
 * Both ends read this one file: the main process, and the client a phone
 * runs. That is why it imports nothing — the client's bundle carries this
 * file and no other part of core, where the barrel would bring the scene
 * model, the guards and every component with it.
 */

export const DEVICE_PROTOCOL_VERSION = 1;

/** The largest body a device may POST. A hello is a few hundred bytes. */
export const DEVICE_BODY_LIMIT = 64 * 1024;

/**
 * How many hellos and statuses one device may send in a window, before it is
 * answered 429. A heartbeat every 20 s and a status on each change is a
 * handful; twenty leaves room for a page that reloads a few times in a row.
 * Its lines are counted apart, against `DEVICE_LOG_RATE`.
 */
export const DEVICE_RATE = { messages: 20, perMs: 10_000 } as const;

/**
 * How many batches of lines one device may post in a window, counted apart
 * from `DEVICE_RATE`. A game that logs every frame sends four batches a
 * second: against the link's twenty it would spend them in five seconds, and
 * the `hello` and `status` that keep its row alive would then be refused — a
 * heartbeat refused long enough is a device the server ends for silence. The
 * client sends at most forty; the rest is room for a second tab of the same
 * browser, which shares its id.
 */
export const DEVICE_LOG_RATE = { messages: 50, perMs: 10_000 } as const;

/** Lines in one batch. */
export const DEVICE_LOG_LINES = 100;

/**
 * A batch's JSON, as the client measures it: under `DEVICE_BODY_LIMIT`, with
 * room left for the envelope.
 */
export const DEVICE_LOG_BYTES = 48 * 1024;

/** Characters in one line. A longer one is cut, its last character `…`. */
export const DEVICE_LOG_TEXT = 4_000;

/**
 * Lines a client keeps while it cannot send them: before its first hello is
 * answered, or while its stream is down. Past that a line is counted rather
 * than kept, and the earliest stay, since a cause comes before its
 * consequences.
 */
export const DEVICE_LOG_PENDING = 500;

/**
 * Between the answer to one batch and the next, and how long the first line
 * after a quiet moment waits for the rest of its burst.
 */
export const DEVICE_LOG_FLUSH_MS = 250;

/**
 * How long a page measures its frames before it reports them: one window. At
 * 60 Hz, 120 intervals make a 95th percentile that is more than one frame's
 * accident, and a status sent to every editor window every two seconds per
 * device costs little.
 */
export const DEVICE_STATS_MS = 2_000;

/**
 * What a page leaves out of its measure after the player starts, and after it
 * turns visible again: shaders compile on the first frames that need them, and
 * those stalls are the boot's, not the game's.
 */
export const DEVICE_STATS_WARMUP_MS = 1_000;

/**
 * How many reports of its frames one device may post in a window, counted apart
 * from the link's and from its lines'. A page sends five in ten seconds; the
 * rest is room for a second tab of the same browser, which shares its id.
 */
export const DEVICE_STATS_RATE = { messages: 10, perMs: 10_000 } as const;

/**
 * The largest frame a device may post, apart from `DEVICE_BODY_LIMIT`: a PNG
 * of its canvas as the page draws it. The largest phone at 3× draws 1320×2868,
 * 15 MB of pixels, and the largest iPad at 2× draws 2064×2752, 23 MB; a PNG of
 * either stays under this even when nothing in it compresses.
 */
export const DEVICE_SCREENSHOT_LIMIT = 32 * 1024 * 1024;

/**
 * How many screenshots the server asks of one device in a window — counted
 * where the server asks, not where a frame arrives. The server reads a frame
 * only when it answers a request still pending, so the uploads are held to the
 * requests already; a request is what makes a phone copy and encode its
 * canvas. A person waits for a dialog between two, so this stops nobody but a
 * script calling the bridge in a loop.
 */
export const DEVICE_SCREENSHOT_RATE = { messages: 5, perMs: 10_000 } as const;

/**
 * How long a device has to begin sending the frame it was asked for, and the
 * longest its upload may then stall. A page that has not begun by then draws
 * no frame to read: a hidden tab, a locked phone, a page that died.
 */
export const DEVICE_SCREENSHOT_WAIT_MS = 10_000;

/** How many devices the server lists at once. Past that, a new stream is refused. */
export const DEVICE_LIMIT = 32;

/**
 * Streams one device may hold. A device is a browser, not a tab, so its tabs
 * share an id; four lets a person open the link twice without one tab
 * evicting the other.
 */
export const DEVICE_STREAMS_PER_DEVICE = 4;

/*
 * Timings, here so that both ends read the same numbers: each side's patience
 * is set against the other's rhythm.
 */

/** What the server asks the browser to wait before reconnecting a stream it lost. */
export const DEVICE_RETRY_MS = 2_000;
/** How often the server writes `ping` to every stream. */
export const DEVICE_PING_MS = 15_000;
/**
 * How long a client waits without a message before it reopens its stream:
 * three pings missed. A phone that slept, or changed network, can hold a
 * connection that is open on its side and gone on the other, and nothing else
 * would ever tell it.
 */
export const DEVICE_STREAM_TIMEOUT_MS = 45_000;
/** How often a client posts its status, so that the server knows it is there. */
export const DEVICE_HEARTBEAT_MS = 20_000;
/**
 * How long the server waits without a message from a device before it ends
 * its streams: three heartbeats missed. A phone that leaves the Wi-Fi does not
 * close its connection, and TCP gives up on it only after minutes.
 */
export const DEVICE_SILENCE_MS = 60_000;
/** How long a device without a stream stays listed, as offline, before it is forgotten. */
export const DEVICE_FORGET_MS = 30_000;

/**
 * How a page reaches the server.
 *
 * Plain HTTP by default: it works everywhere with nothing to accept first, but
 * a browser treats a page on a LAN address as an insecure context, which costs
 * WebGPU on a phone. HTTPS, under a certificate this computer signs for
 * itself, gives the page a secure context once each browser has accepted it.
 * Here rather than with the settings, so that the client can read a transport
 * the server names without carrying the settings' guards.
 */
export const DEVICE_TRANSPORTS = ['http', 'https'] as const;

export type DeviceTransport = (typeof DEVICE_TRANSPORTS)[number];

export function isDeviceTransport(value: unknown): value is DeviceTransport {
  return DEVICE_TRANSPORTS.some((transport) => transport === value);
}

/** Where a page is: the waiting page, the player loading, the game running, or the error it stopped on. */
export type DeviceState = 'waiting' | 'booting' | 'running' | 'failed';

/** What the player draws with. WebGPU needs a secure context; anything else gets WebGL2. */
export type DeviceBackend = 'webgpu' | 'webgl';

/** The messages a device POSTs, by the last segment of their path. */
export type DeviceMessageType = 'hello' | 'status' | 'log' | 'stats';

/**
 * Sent on every stream a page opens: who the device is, and where its page
 * stands. One message for a first visit and for a reconnection alike, so that
 * a page back from sleep on an old launch is restarted by the answer to it.
 */
export interface DeviceHello {
  v: typeof DEVICE_PROTOCOL_VERSION;
  device: string;
  /** The launch the page runs; `null` on the waiting page. */
  launch: string | null;
  userAgent: string;
  screen: { width: number; height: number; dpr: number };
  /** Whether the browser counts the page as a secure context, which WebGPU needs. */
  secureContext: boolean;
  state: DeviceState;
  backend: DeviceBackend | null;
  error: string | null;
  /**
   * The page before this one, in this tab, ended while it was in the
   * foreground without going the way a page goes — and nobody asked for this
   * load. On a phone, that is a page its browser ended for the memory it used,
   * then loaded again. Sent until a hello carrying it has been answered.
   */
  reloaded: boolean;
}

/** Sent on each change of state, and every `DEVICE_HEARTBEAT_MS`. */
export interface DeviceStatusReport {
  v: typeof DEVICE_PROTOCOL_VERSION;
  device: string;
  state: DeviceState;
  backend: DeviceBackend | null;
  error: string | null;
}

/** The Console's three levels. A page's `info` is a message; its `debug` is not sent. */
export type DeviceLogLevel = 'log' | 'warn' | 'error';

/** One line a page logged, folded with the identical ones logged right after it. */
export interface DeviceLogLine {
  level: DeviceLogLevel;
  text: string;
  /** How many times in a row it was logged. */
  count: number;
}

/**
 * Lines a page logged, from its very first, sent once the hello of its
 * current stream has been answered: the server ignores a device it does not
 * know yet.
 */
export interface DeviceLogMessage {
  v: typeof DEVICE_PROTOCOL_VERSION;
  device: string;
  /**
   * The launch the page that logged them runs; `null` on the waiting page. A
   * page sends what it still holds as it goes, and that batch arrives once the
   * next launch is current, when its run's lines have left every Console: the
   * server drops it.
   */
  launch: string | null;
  lines: DeviceLogLine[];
  /** Lines lost since the last batch the server took: past the client's queue, or refused. */
  dropped: number;
}

/**
 * What a page measured over its last window, and what its renderer counts.
 *
 * Measured on the device, since the editor sees nothing of its frames: the
 * page's own `requestAnimationFrame` runs in the same frames as the player's
 * loop, so a frame late for the game is late for the measure too.
 */
export interface DeviceStats {
  /** The median frame rate over the window, rounded. */
  fps: number;
  /** The 95th percentile of the frame intervals, in ms, to a tenth: what stutter is made of. */
  p95: number;
  /** Frames counted in the window. */
  frames: number;
  /** The last frame's, as the renderer counted them. */
  drawCalls: number;
  triangles: number;
  textures: number;
  /** What the renderer gave the GPU, in bytes: three's own count, not the browser's. */
  gpuMemory: number;
  /** The ratio the page draws at: the device's, capped by the project or the launch options. */
  pixelRatio: number;
  /** The canvas's drawing buffer, in pixels. */
  width: number;
  height: number;
  /**
   * The frame rate was held at 30 for two windows in a row: on a phone, most
   * likely a power-saving mode that throttles every page.
   */
  pinned30: boolean;
}

/** A page's stats, as it posts them every `DEVICE_STATS_MS` while the player runs. */
export interface DeviceStatsReport extends DeviceStats {
  v: typeof DEVICE_PROTOCOL_VERSION;
  device: string;
  /**
   * The launch the page that measured runs. A report that arrives once the next
   * launch is current measured a page already replaced: the server drops it.
   */
  launch: string | null;
}

/** What the server writes to a stream. */
export type ServerMessage =
  /** Restart on that launch. */
  | { v: typeof DEVICE_PROTOCOL_VERSION; type: 'launch'; launch: string }
  /** The editor stopped serving: the next error is not the network's. */
  | { v: typeof DEVICE_PROTOCOL_VERSION; type: 'stopped' }
  /** Nothing to do: the stream is alive. */
  | { v: typeof DEVICE_PROTOCOL_VERSION; type: 'ping' }
  /**
   * The server is about to listen again under that scheme, on the same port:
   * open this same page there.
   */
  | { v: typeof DEVICE_PROTOCOL_VERSION; type: 'reopen'; transport: DeviceTransport }
  /**
   * What the page draws for itself, as the launch options say: written as each
   * stream opens, and to every stream when it changes, so it takes effect
   * without a reload.
   */
  | { v: typeof DEVICE_PROTOCOL_VERSION; type: 'options'; stats: boolean }
  /**
   * Post the next frame the player draws to `__studio/screenshot?request=…`.
   * Written to every stream of the device, since its tabs share its id; a page
   * that draws no frame — hidden, or not running the game — lets it go.
   */
  | { v: typeof DEVICE_PROTOCOL_VERSION; type: 'screenshot'; request: string };

const STATES: readonly DeviceState[] = ['waiting', 'booting', 'running', 'failed'];
const BACKENDS: readonly DeviceBackend[] = ['webgpu', 'webgl'];
const LOG_LEVELS: readonly DeviceLogLevel[] = ['log', 'warn', 'error'];

const USER_AGENT_LIMIT = 512;
const ERROR_LIMIT = 2_000;

/** Wider than any screen, so that only nonsense is clamped. */
const SCREEN_LIMIT = 100_000;
const DPR_LIMIT = 16;

/*
 * Bounds for a report's numbers: far past anything a page could measure, so
 * that only nonsense is clamped, and never so large that a row cannot write it.
 */
const FPS_LIMIT = 1_000;
const FRAME_TIME_LIMIT = 60_000;
const COUNT_LIMIT = 1e9;
const MEMORY_LIMIT = 1e12;
const BUFFER_LIMIT = 65_536;

/**
 * An id the client made, or one the server made for a launch: letters and
 * digits, 8 to 64. Never anything that could be a path, a header or markup,
 * since a device's id is written into all three.
 */
const ID = /^[A-Za-z0-9]{8,64}$/;

function isId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value);
}

/** A device's id, as the client makes it with `createId(16)` and keeps in `localStorage`. */
export function isDeviceId(value: unknown): value is string {
  return isId(value);
}

/**
 * The id the server made for one screenshot request, with `createId(16)`. The
 * page writes it into the path it posts its frame to, so it is held to what a
 * device's id is held to.
 */
export function isRequestId(value: unknown): value is string {
  return isId(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stateOf(value: unknown): DeviceState | null {
  return STATES.find((state) => state === value) ?? null;
}

function backendOf(value: unknown): DeviceBackend | null {
  return BACKENDS.find((backend) => backend === value) ?? null;
}

function textOf(value: unknown, limit: number): string | null {
  return typeof value === 'string' ? value.slice(0, limit) : null;
}

/** A number a row can show: finite, and within what a screen could be. */
function numberOf(value: unknown, fallback: number, limit: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(Math.max(value, 0), limit)
    : fallback;
}

/** A safe integer of at least `least`, or `least`. */
function countOf(value: unknown, least: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= least ? value : least;
}

/** The fields every device message starts with, or `null` when they do not make one. */
function envelopeOf(value: unknown): { device: string; body: Record<string, unknown> } | null {
  if (!isRecord(value) || value['v'] !== DEVICE_PROTOCOL_VERSION) return null;
  const device = value['device'];
  return isDeviceId(device) ? { device, body: value } : null;
}

/**
 * A hello, as the server keeps it, or `null` when it is not one.
 *
 * Refused only for what makes it no message at all: another version, or no
 * device it could be from. Everything else is repaired — a page that sent one
 * field wrong is still a device worth listing — and bounded, since what is
 * kept here is shown in every editor window and written to the trace.
 */
export function conformHello(value: unknown): DeviceHello | null {
  const envelope = envelopeOf(value);
  if (envelope === null) return null;
  const { device, body } = envelope;
  const launch = body['launch'];
  const screen = isRecord(body['screen']) ? body['screen'] : {};
  return {
    v: DEVICE_PROTOCOL_VERSION,
    device,
    launch: isId(launch) ? launch : null,
    userAgent: textOf(body['userAgent'], USER_AGENT_LIMIT) ?? '',
    screen: {
      width: numberOf(screen['width'], 0, SCREEN_LIMIT),
      height: numberOf(screen['height'], 0, SCREEN_LIMIT),
      dpr: numberOf(screen['dpr'], 1, DPR_LIMIT),
    },
    secureContext: body['secureContext'] === true,
    // A hello is how a device is listed at all, so a state this build does not
    // know is read as the least it could mean rather than lose the device.
    state: stateOf(body['state']) ?? 'waiting',
    backend: backendOf(body['backend']),
    error: textOf(body['error'], ERROR_LIMIT),
    reloaded: body['reloaded'] === true,
  };
}

/**
 * A status, or `null` when it is not one. Unlike a hello, a state this build
 * does not know refuses it: the device is listed already, and keeping its last
 * known state is truer than guessing a new one.
 */
export function conformStatusReport(value: unknown): DeviceStatusReport | null {
  const envelope = envelopeOf(value);
  if (envelope === null) return null;
  const { device, body } = envelope;
  const state = stateOf(body['state']);
  if (state === null) return null;
  return {
    v: DEVICE_PROTOCOL_VERSION,
    device,
    state,
    backend: backendOf(body['backend']),
    error: textOf(body['error'], ERROR_LIMIT),
  };
}

/**
 * A line as both ends keep it: at most `DEVICE_LOG_TEXT` characters, the last
 * one `…` when it was cut. The client cuts before it queues a line, and the
 * server again as a batch arrives, so a line is cut one way whoever cut it.
 */
export function cutLogText(text: string): string {
  return text.length > DEVICE_LOG_TEXT ? `${text.slice(0, DEVICE_LOG_TEXT - 1)}…` : text;
}

/**
 * A batch of lines, or `null` when it is not one.
 *
 * Refused only for what makes it no message at all: another version, no
 * device, no list of lines. A line is repaired where it can be — a level this
 * build does not know is a message, a count that is not one is 1 — and left
 * out when it has no text. What is left out, with the lines past a batch's
 * hundred, joins the dropped count, so that the Console says they were lost.
 */
export function conformLogMessage(value: unknown): DeviceLogMessage | null {
  const envelope = envelopeOf(value);
  if (envelope === null) return null;
  const { device, body } = envelope;
  const lines = body['lines'];
  if (!Array.isArray(lines)) return null;
  const launch = body['launch'];
  const kept: DeviceLogLine[] = [];
  let leftOut = 0;
  for (const line of lines) {
    if (kept.length === DEVICE_LOG_LINES || !isRecord(line) || typeof line['text'] !== 'string') {
      leftOut += 1;
      continue;
    }
    const level = line['level'];
    kept.push({
      level: LOG_LEVELS.find((known) => known === level) ?? 'log',
      text: cutLogText(line['text']),
      count: countOf(line['count'], 1),
    });
  }
  return {
    v: DEVICE_PROTOCOL_VERSION,
    device,
    // Read as a hello reads its own, and never a reason to refuse the batch.
    launch: isId(launch) ? launch : null,
    lines: kept,
    dropped: countOf(body['dropped'], 0) + leftOut,
  };
}

/** A whole number within its bound: a count, a rate, a size in pixels or bytes. */
function wholeOf(value: unknown, limit: number): number {
  return Math.round(numberOf(value, 0, limit));
}

/**
 * A page's report, or `null` when it is not one.
 *
 * Refused only for what makes it no message at all: another version, or no
 * device. A number that is not one reads 0, and every number is bounded,
 * since each is written in every editor window.
 */
export function conformStatsReport(value: unknown): DeviceStatsReport | null {
  const envelope = envelopeOf(value);
  if (envelope === null) return null;
  const { device, body } = envelope;
  const launch = body['launch'];
  return {
    v: DEVICE_PROTOCOL_VERSION,
    device,
    launch: isId(launch) ? launch : null,
    fps: wholeOf(body['fps'], FPS_LIMIT),
    p95: Math.round(numberOf(body['p95'], 0, FRAME_TIME_LIMIT) * 10) / 10,
    frames: wholeOf(body['frames'], COUNT_LIMIT),
    drawCalls: wholeOf(body['drawCalls'], COUNT_LIMIT),
    triangles: wholeOf(body['triangles'], COUNT_LIMIT),
    textures: wholeOf(body['textures'], COUNT_LIMIT),
    gpuMemory: wholeOf(body['gpuMemory'], MEMORY_LIMIT),
    pixelRatio: numberOf(body['pixelRatio'], 0, DPR_LIMIT),
    width: wholeOf(body['width'], BUFFER_LIMIT),
    height: wholeOf(body['height'], BUFFER_LIMIT),
    pinned30: body['pinned30'] === true,
  };
}

/**
 * One message from the stream, as the client reads it, or `null`.
 *
 * Anything this client does not know — a type a newer server added, another
 * version — is `null` rather than an error: the stream carries on, and the
 * message still proves that it is alive.
 */
export function parseServerMessage(data: string): ServerMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(value) || value['v'] !== DEVICE_PROTOCOL_VERSION) return null;
  switch (value['type']) {
    case 'launch': {
      const launch = value['launch'];
      return isId(launch) ? { v: DEVICE_PROTOCOL_VERSION, type: 'launch', launch } : null;
    }
    case 'stopped':
      return { v: DEVICE_PROTOCOL_VERSION, type: 'stopped' };
    case 'ping':
      return { v: DEVICE_PROTOCOL_VERSION, type: 'ping' };
    case 'reopen': {
      const transport = value['transport'];
      return isDeviceTransport(transport)
        ? { v: DEVICE_PROTOCOL_VERSION, type: 'reopen', transport }
        : null;
    }
    case 'options':
      return { v: DEVICE_PROTOCOL_VERSION, type: 'options', stats: value['stats'] === true };
    case 'screenshot': {
      const request = value['request'];
      return isRequestId(request)
        ? { v: DEVICE_PROTOCOL_VERSION, type: 'screenshot', request }
        : null;
    }
    default:
      return null;
  }
}
