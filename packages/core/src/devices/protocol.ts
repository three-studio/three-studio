/*
 * What a device and the device server say to each other, version 1.
 *
 * The server writes to an event stream the page opens; the page POSTs its own
 * messages back, one JSON body each, to `__studio/<type>`. No WebSocket: an
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
 * How many messages one device may send in a window, before it is answered
 * 429. A heartbeat every 20 s and a status on each change is a handful;
 * twenty leaves room for a page that reloads a few times in a row.
 */
export const DEVICE_RATE = { messages: 20, perMs: 10_000 } as const;

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
export type DeviceMessageType = 'hello' | 'status';

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
}

/** Sent on each change of state, and every `DEVICE_HEARTBEAT_MS`. */
export interface DeviceStatusReport {
  v: typeof DEVICE_PROTOCOL_VERSION;
  device: string;
  state: DeviceState;
  backend: DeviceBackend | null;
  error: string | null;
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
  | { v: typeof DEVICE_PROTOCOL_VERSION; type: 'reopen'; transport: DeviceTransport };

const STATES: readonly DeviceState[] = ['waiting', 'booting', 'running', 'failed'];
const BACKENDS: readonly DeviceBackend[] = ['webgpu', 'webgl'];

const USER_AGENT_LIMIT = 512;
const ERROR_LIMIT = 2_000;

/** Wider than any screen, so that only nonsense is clamped. */
const SCREEN_LIMIT = 100_000;
const DPR_LIMIT = 16;

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
    default:
      return null;
  }
}
