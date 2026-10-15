import { conform, conformMaterial, conformPatch } from '../guards';
import { createId } from '../ids';
import {
  createPhysicsSettings,
  createRenderingSettings,
  type PhysicsSettings,
  type RenderingSettings,
} from '../project/schema';
import { migratePrefab, type PrefabDoc } from '../scene/prefab';
import type { MaterialDef, SceneDoc } from '../scene/schema';
import { migrateScene } from '../scene/serialization';
import {
  isDeviceTransport,
  type DeviceBackend,
  type DeviceLogLine,
  type DeviceState,
  type DeviceStats,
  type DeviceTransport,
} from './protocol';

export type { DeviceTransport } from './protocol';

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

/** The entries of a record that arrived from elsewhere: none when it is not one. */
function entriesOf(value: unknown): [string, unknown][] {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.entries(value)
    : [];
}

/**
 * A snapshot, made safe where it arrives in the main process.
 *
 * Whatever the renderer sent: a project's own script can call the bridge with
 * anything, and what it sends becomes the files a phone downloads. Each part
 * goes through the repair its kind already has — a scene and a prefab through
 * their migrations, which keep what a newer editor wrote; a material and the
 * settings against their factories. A field this does not know is dropped:
 * nothing here is kept on disk, and the renderer that sends it ships in the
 * same build.
 *
 * Refused outright when it cannot be read as a launch at all: a version this
 * build does not know, or an entry scene with no id and name to serve it under.
 */
export function conformLaunchSnapshot(value: unknown): LaunchSnapshot {
  if (typeof value !== 'object' || value === null) {
    throw new Error('A launch snapshot is an object.');
  }
  const given = value as Record<string, unknown>;
  if (given['version'] !== LAUNCH_SNAPSHOT_VERSION) {
    throw new Error(`This build cannot launch a snapshot of version ${String(given['version'])}.`);
  }
  const entry = given['entry'];
  const { id, name, scene } = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<
    string,
    unknown
  >;
  if (typeof id !== 'string' || typeof name !== 'string') {
    throw new Error('A launch snapshot names its entry scene by id and name.');
  }

  const materials: Record<string, MaterialDef> = {};
  for (const [key, material] of entriesOf(given['materials'])) {
    materials[key] = conformMaterial(material);
  }
  const prefabs: Record<string, PrefabDoc> = {};
  for (const [key, prefab] of entriesOf(given['prefabs'])) {
    if (typeof prefab === 'object' && prefab !== null) prefabs[key] = migratePrefab(prefab as PrefabDoc);
  }
  const loadingScene = given['loadingScene'];

  return {
    version: LAUNCH_SNAPSHOT_VERSION,
    entry: { id, name, scene: migrateScene(scene) },
    materials,
    prefabs,
    rendering: conform(given['rendering'], createRenderingSettings()),
    physics: conform(given['physics'], createPhysicsSettings()),
    loadingScene: typeof loadingScene === 'string' ? loadingScene : null,
  };
}

/*
 * ------------------------------------------------------------- the settings
 */

export const DEVICE_SETTINGS_VERSION = 1;

/** The port asked for first, unless someone chose another. */
export const DEFAULT_DEVICE_PORT = 7700;

/**
 * What every device is launched with beyond what the project says: a way to
 * see a phone otherwise — on WebGL2, at another pixel ratio, with its numbers
 * on screen — without touching the project. One set for every device.
 */
export interface DeviceLaunchOptions {
  /**
   * Draw with WebGL2 even where WebGPU is offered. Served in the `build.json`
   * a device fetches, so the player reads it as it reads any export's, and
   * every device restarts on it.
   */
  forceWebGL: boolean;
  /**
   * The highest ratio a device draws at, 1 to 3 as the project's own setting
   * takes; `null` keeps the project's. Served in `build.json` too.
   */
  maxPixelRatio: number | null;
  /** Each device draws its numbers in a corner. Sent down the stream: no restart. */
  stats: boolean;
}

/** As the project says: nothing forced, its own pixel ratio, no numbers on screen. */
export function createDeviceLaunchOptions(): DeviceLaunchOptions {
  return { forceWebGL: false, maxPixelRatio: null, stats: false };
}

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
  /**
   * Plain HTTP unless someone chose HTTPS. A setting rather than a literal in
   * any URL, so that every link, every QR code and the client follow it.
   */
  transport: DeviceTransport;
  /**
   * The IPv4 address the link is made of — what the QR code shows — or `null`
   * to let the server pick one.
   *
   * An address rather than an interface: Tailscale's address stays the same
   * from one connection to the next while its `utunN` interface changes. While
   * the address is not connected — another Wi-Fi, a lease that moved — the
   * link is chosen as if nobody had, which puts the Wi-Fi first anyway, and the
   * file keeps the choice, so it applies again when the network comes back.
   */
  address: string | null;
  /**
   * Whether every device relaunches by itself a second after each change made
   * in the editor. Off unless someone turns it on: a phone that restarts on
   * every edit is a surprise nobody asked for.
   *
   * Kept here rather than in a window, so every window shows the same choice;
   * the server does nothing with it. What changed lives in the editor's
   * stores, so the editor is what relaunches.
   */
  liveReload: boolean;
  /**
   * Kept per machine rather than in the project: they are how this person
   * looks at their phones today, not how the game is made — an export never
   * carries them.
   */
  launchOptions: DeviceLaunchOptions;
  /**
   * A project's path → the folder its last screenshot was saved in, where the
   * next one's Save dialog opens. By path, since a project has no id — its
   * recent entry is kept by path for the same reason — and here rather than in
   * the project, since a folder on this computer means nothing on another.
   * Written by the main process alone, as a screenshot is saved.
   */
  screenshotFolders: Record<string, string>;
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
    address: null,
    liveReload: false,
    launchOptions: createDeviceLaunchOptions(),
    screenshotFolders: {},
  };
}

/** A port a server can listen on. `conform` checks it is a number, not which one. */
function isPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

/**
 * Four decimal octets, written the way `os.networkInterfaces()` writes them —
 * the only addresses the server ever lists, so the only ones worth keeping.
 * `conform` would keep any string here, since that is what a `null` field
 * accepts everywhere else at the boundary.
 */
function isDeviceAddress(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const octets = value.split('.');
  return (
    octets.length === 4 &&
    octets.every((octet) => /^(?:0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A cap the project's own setting could hold — 1 to 3 — or `null` for the
 * project's. Checked by hand, from the value as it was given: `conform` reads
 * a `null` field as one that takes a string, so it would keep `'2'` there and
 * drop a number.
 */
function isPixelRatioCap(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && value >= 1 && value <= 3);
}

/** The cap a value holds, or `null` — the project's — when it holds none that will do. */
function pixelRatioCapOf(options: unknown): number | null {
  const cap = isRecord(options) ? options['maxPixelRatio'] : null;
  return isPixelRatioCap(cap) ? cap : null;
}

/**
 * The screenshot folders a file names, entry by entry: a project's path and a
 * folder, both strings with something in them. Read by hand, since `conform`
 * reads an object by the factory's own keys, and the factory's map has none.
 */
function screenshotFoldersOf(value: unknown): Record<string, string> {
  const folders: Record<string, string> = {};
  if (!isRecord(value)) return folders;
  for (const [project, folder] of Object.entries(value)) {
    if (project !== '' && typeof folder === 'string' && folder !== '') folders[project] = folder;
  }
  return folders;
}

/**
 * What a server runs on, from whatever the file holds.
 *
 * Filled from the factory, then four checks `conform` cannot make, since each
 * of these is a number or a string like any other: a port that can be listened
 * on, a token worth keeping, a transport this build can serve, an address the
 * server could list. Anything else takes the factory's value.
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
    transport: isDeviceTransport(settings.transport) ? settings.transport : factory.transport,
    address: isDeviceAddress(settings.address) ? settings.address : factory.address,
    launchOptions: {
      ...settings.launchOptions,
      maxPixelRatio: pixelRatioCapOf(isRecord(value) ? value['launchOptions'] : null),
    },
    screenshotFolders: screenshotFoldersOf(isRecord(value) ? value['screenshotFolders'] : null),
  };
}

/**
 * What the renderer may change in the settings.
 *
 * The port, the address the link is made of, the transport, live reload, and
 * the launch options it names — each one alone, so that ticking one option
 * leaves the others as the file has them. Never the token: the renderer is
 * where a project's own scripts run, and a token one of them chose would be a
 * link it already knows. Never the version, which is the file's to say. Never
 * a screenshot folder: the person names one in a Save dialog, which the main
 * process shows.
 */
export type DeviceSettingsPatch = Partial<
  Pick<DeviceSettings, 'port' | 'address' | 'transport' | 'liveReload'>
> & { launchOptions?: Partial<DeviceLaunchOptions> };

/**
 * The launch options a patch names, each conformed; the rest left out.
 *
 * Conformed apart from the settings' patch, which would conform them as one
 * whole value: every option the caller did not name would come back as the
 * factory's, and be written over the file's.
 */
function conformLaunchOptionsPatch(value: unknown): Partial<DeviceLaunchOptions> {
  const patch: Partial<DeviceLaunchOptions> = conformPatch(value, createDeviceLaunchOptions());
  delete patch.maxPixelRatio;
  if (isRecord(value) && 'maxPixelRatio' in value) {
    const cap = value['maxPixelRatio'];
    if (isPixelRatioCap(cap)) patch.maxPixelRatio = cap;
  }
  return patch;
}

/**
 * A patch, reduced to what it may change.
 *
 * A port out of range, or an address that is not one, is left out rather than
 * replaced by the factory's: the caller asked to change one thing, and the
 * honest answer to nonsense is to change nothing. `null` stays: it is how the
 * choice of an address is given back to the server.
 */
export function conformDeviceSettingsPatch(value: unknown): DeviceSettingsPatch {
  const model: Required<Omit<DeviceSettingsPatch, 'launchOptions'>> = {
    port: DEFAULT_DEVICE_PORT,
    address: null,
    transport: 'http',
    liveReload: false,
  };
  const patch: DeviceSettingsPatch = conformPatch(value, model);
  if (patch.port !== undefined && !isPort(patch.port)) delete patch.port;
  if (typeof patch.address === 'string' && !isDeviceAddress(patch.address)) delete patch.address;
  if (patch.transport !== undefined && !isDeviceTransport(patch.transport)) delete patch.transport;
  if (isRecord(value) && 'launchOptions' in value) {
    const launchOptions = conformLaunchOptionsPatch(value['launchOptions']);
    // Options that change nothing this build knows are no change at all.
    if (Object.keys(launchOptions).length > 0) patch.launchOptions = launchOptions;
  }
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

/** The certificate a server running over HTTPS answers with, as the editor shows it. */
export interface DeviceCertificateStatus {
  /** SHA-256, `AB:CD:…`: what a person compares with what the phone shows before accepting. */
  fingerprint: string;
  /** This start replaced a certificate that phones may have accepted: they ask again. */
  renewed: boolean;
  /** Addresses whose browser refused the certificate, with no request answered since. */
  refusedBy: string[];
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
  /**
   * The settings' address, whether the server runs or not: `null` when the
   * server picks the link. `selectedUrl` is made of it only while it is
   * listed.
   */
  address: string | null;
  /** The settings' live reload, whether the server runs or not. */
  liveReload: boolean;
  /** The settings' launch options, whether the server runs or not. */
  launchOptions: DeviceLaunchOptions;
  /**
   * Every device that said hello since the server started, connected or not,
   * in the order they first did. Empty while the server is stopped.
   */
  devices: DeviceInfo[];
  /** While running over HTTPS; `null` otherwise. Never the key: the main process keeps it. */
  certificate: DeviceCertificateStatus | null;
}

/**
 * A device that said hello, as a row in the editor shows it.
 *
 * Kept in the server's memory only: a stop forgets every device, and a device
 * is listed again by the next hello its page sends.
 */
export interface DeviceInfo {
  /** The id its browser keeps; every tab of one browser shares it. */
  id: string;
  /** The system, from its user agent: `iPhone`, `Android`, `Mac`… */
  name: string;
  browser: string;
  /** As sent, at most 512 characters. */
  userAgent: string;
  /** Where its stream came from. */
  address: string;
  screen: { width: number; height: number; dpr: number };
  /** Whether its page is a secure context. Without one a browser offers no WebGPU. */
  secureContext: boolean;
  /** The launch its page runs; `null` on the waiting page. */
  launch: string | null;
  state: DeviceState;
  backend: DeviceBackend | null;
  error: string | null;
  /** A stream is open. A device without one stays listed a little while, as offline. */
  connected: boolean;
  /**
   * What its page measured last, over its last two seconds; `null` until the
   * page that runs now has reported. Emptied whenever the device is told to
   * restart, says hello, or loses its last stream: every page is measured on
   * its own.
   */
  stats: DeviceStats | null;
  /**
   * How many times its browser reloaded a page that ended in the foreground,
   * since it was listed — on a phone, a page that ran out of memory. The
   * device's, so it outlives every launch.
   */
  reloads: number;
}

/**
 * One device's lines, as main hands them to every editor window.
 *
 * Its name and browser are stamped as the lines arrive, rather than looked
 * up by its id later: a device leaves the list half a minute after its last
 * stream closes, and every device leaves it when the server changes scheme,
 * while its last lines may still be on their way to a window.
 */
export interface DeviceLogs {
  /** Its id. */
  device: string;
  /** From its user agent, as its row says it. */
  name: string;
  browser: string;
  lines: DeviceLogLine[];
  /** Its lines lost on the way since its last batch. */
  dropped: number;
}

/** A device's frame, saved where the person said. */
export interface DeviceScreenshot {
  /** The file written. */
  path: string;
  /** From the PNG's header: the canvas as the page drew it. */
  width: number;
  height: number;
  /** The file's size. */
  bytes: number;
}
