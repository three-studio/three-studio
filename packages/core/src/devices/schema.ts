import { conform, conformPatch } from '../guards';
import { createId } from '../ids';
import type { PhysicsSettings, RenderingSettings } from '../project/schema';
import type { PrefabDoc } from '../scene/prefab';
import type { MaterialDef, SceneDoc } from '../scene/schema';

export const LAUNCH_SNAPSHOT_VERSION = 1;

/**
 * What a device launch runs: the editor's in-memory state, as Play would run it.
 *
 * Read from memory rather than from disk, because the point of launching on a
 * phone is to see what is on screen — unsaved edits included — and launching
 * may not save. Scripts are not in it: the main process compiles them from
 * disk, as Play does. Every other scene is read from disk when asked for, as
 * Play does too.
 */
export interface LaunchSnapshot {
  version: typeof LAUNCH_SNAPSHOT_VERSION;
  /**
   * The scene on screen — in Prefab Mode, the scene the prefab was opened from.
   *
   * `id` and `name` are the window's, never the document's own `id`: the
   * window's id is what the project's scene list and every reference use, and
   * the entry is always answered from here, so it needs no file on disk.
   */
  entry: { id: string; name: string; scene: SceneDoc };
  /** The asset store's, with Prefab Mode's unsaved edits composed in. */
  materials: Record<string, MaterialDef>;
  prefabs: Record<string, PrefabDoc>;
  /** The project's current settings, as held in memory. */
  rendering: RenderingSettings;
  physics: PhysicsSettings;
  loadingScene: string | null;
}

/*
 * ------------------------------------------------------------- the settings
 */

/**
 * How a device reaches the server.
 *
 * Plain HTTP alone for now: a browser treats a page on a LAN address as an
 * insecure context, which costs WebGPU on a phone, but it works everywhere with
 * nothing to accept first. The scheme is still a setting rather than a literal
 * so that no URL anywhere has to be written with one.
 */
export type DeviceTransport = 'http';

export const DEVICE_SETTINGS_VERSION = 1;

/** The port asked for first, unless someone chose another. */
export const DEFAULT_DEVICE_PORT = 7700;

/**
 * What the device server keeps between runs, in the app's data directory.
 *
 * Per machine, never in the project: the token is a secret, and a phone's
 * bookmark — the port and the token — has to survive opening another project.
 */
export interface DeviceSettings {
  version: number;
  /**
   * The port asked for first. When something else holds it, the server takes
   * the next free one for that run only, and the file keeps this one, so a
   * bookmark works again as soon as the port is free.
   */
  port: number;
  /** The first segment of every URL the server answers. See `createDeviceToken`. */
  token: string;
  transport: DeviceTransport;
}

/**
 * A new secret for the device URLs.
 *
 * The server listens on every interface, so anyone on the same network can
 * reach it, and the token is all that keeps them out of the project's files:
 * 22 characters of a 62-letter alphabet, about 131 bits — far beyond guessing
 * at the rate a phone or a script can ask. Letters and digits only, so it sits
 * in a URL path and a QR code with nothing to escape.
 */
export function createDeviceToken(): string {
  return createId(22);
}

/**
 * Whether a token is long enough to keep, and can be written in a URL as it is.
 *
 * Any token in base64url's alphabet, not only one `createId` could have made:
 * what matters is that it sits in a path segment with nothing to escape. Any
 * token shorter than the factory's is replaced, and written back: a file
 * truncated, or edited down to something memorable, is a link anyone on the
 * network can guess.
 */
export function isUsableDeviceToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{22,}$/.test(value);
}

export function createDeviceSettings(): DeviceSettings {
  return {
    version: DEVICE_SETTINGS_VERSION,
    port: DEFAULT_DEVICE_PORT,
    token: createDeviceToken(),
    transport: 'http',
  };
}

/** A port a server can listen on. `conform` checks it is a number, not which one. */
function isPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

/**
 * What a server runs on, from whatever the file holds.
 *
 * Filled from the factory, then three checks `conform` cannot make, since each
 * of these is a number or a string like any other: a port that can be listened
 * on, a token worth keeping, a transport this build can serve. Anything else
 * takes the factory's value.
 *
 * This is a reading, not a repair. What the file holds beyond it — a field a
 * newer build added, a transport it knows — is somebody's, and stays there:
 * keeping the file as found is the loader's job, not this one's.
 */
export function conformDeviceSettings(value: unknown): DeviceSettings {
  const factory = createDeviceSettings();
  const settings = conform(value, factory);
  return {
    ...settings,
    port: isPort(settings.port) ? settings.port : factory.port,
    token: isUsableDeviceToken(settings.token) ? settings.token : factory.token,
    transport: settings.transport === 'http' ? settings.transport : factory.transport,
  };
}

/**
 * What the renderer may change in the settings.
 *
 * The port alone. Never the token: the renderer is where a project's own
 * scripts run, and a token one of them chose would be a link it already knows.
 * Never the version, which is the file's to say.
 */
export type DeviceSettingsPatch = Partial<Pick<DeviceSettings, 'port'>>;

/**
 * A patch, reduced to what it may change.
 *
 * A port out of range is left out rather than replaced by the factory's: the
 * caller asked to change one thing, and the honest answer to nonsense is to
 * change nothing.
 */
export function conformDeviceSettingsPatch(value: unknown): DeviceSettingsPatch {
  const patch: DeviceSettingsPatch = conformPatch(value, { port: DEFAULT_DEVICE_PORT });
  if (patch.port !== undefined && !isPort(patch.port)) delete patch.port;
  return patch;
}

/*
 * --------------------------------------------------------------- the status
 */

/** One way to reach the server, as a person picks it: an address, what it is, and the link. */
export interface DeviceUrl {
  /** An IPv4 address the server listens on, or `localhost`. */
  address: string;
  /** The interface it is on, `Tailscale`, or `This computer` for `localhost`. */
  label: string;
  /** The page a device opens, token included. */
  url: string;
}

export type DeviceServerState = 'stopped' | 'starting' | 'running' | 'error';

/** The process holding the port the settings ask for, as the system describes it. */
export interface PortHolder {
  pid: number;
  /** Its executable, or `null` when the system will not say. */
  program: string | null;
  /**
   * It runs this very executable: another Three Studio, which the editor may
   * offer to quit. Any other holder is only ever named.
   */
  sameApp: boolean;
}

/**
 * The device server, as the editor shows it. Sent whole on every change: it is
 * small, and a window that missed one change needs nothing but the next.
 */
export interface DeviceServerStatus {
  state: DeviceServerState;
  /** Why it could not start, in the `error` state. */
  error?: string;
  /** The running server's; the settings' otherwise. */
  transport: DeviceTransport;
  /** The port listened on while running; the settings' otherwise. */
  port: number;
  /** The settings' port: the one asked for first, which `port` differs from after a slide. */
  requestedPort: number;
  /** Who holds `requestedPort` after a slide, when the system says. */
  portHolder: PortHolder | null;
  /** Every link to the server, the likeliest first. Empty unless running. */
  urls: DeviceUrl[];
  /** The link to show first, or `null` when there is none. */
  selectedUrl: string | null;
  /** What a device runs; `null` before the first launch, and after a stop. */
  launch: { id: string; at: number; sceneName: string } | null;
  /**
   * Whether a request has ever come from another machine. Until one has, a
   * phone that cannot load the page is likely held off by a firewall, which
   * refuses without a word.
   */
  reachedFromNetwork: boolean;
}
