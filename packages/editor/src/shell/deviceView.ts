import {
  DEFAULT_DEVICE_PORT,
  type DeviceBackend,
  type DeviceInfo,
  type DeviceServerState,
  type DeviceServerStatus,
  type DeviceState,
  type DeviceTransport,
  type Platform,
} from '@three-studio/core';
import {
  deviceLabel,
  deviceLink,
  hasSlid,
  holderName,
  liveReloadState,
  localDeviceUrl,
  type LiveReloadState,
  type OwnLaunch,
} from '../state/deviceStore';

/*
 * What the device button and its popover say, read from the status alone.
 *
 * Pure, so that every state the server can be in is checked without a DOM:
 * the components only draw what this returns.
 */

/** The dot on the button's icon: nothing while stopped. */
export type DeviceDot = 'none' | 'starting' | 'running' | 'slid' | 'error';

/** One device, as its row in the popover says it. */
export interface DeviceRow {
  id: string;
  /** `iPhone · Safari`. */
  label: string;
  /** What it draws with — `WebGPU`, `WebGL2` — while it runs; `null` otherwise. */
  backend: string | null;
  /** Its page is not a secure context, which is why it has no WebGPU. */
  insecure: boolean;
  /** A secure context, and WebGL2 all the same: the browser gave its page no WebGPU. */
  noWebGpu: boolean;
  /** `393×852 @3x`: the screen in CSS pixels, and its pixel ratio. */
  screen: string;
  /** What the page is doing: the backend while it runs, `Offline` without a stream. */
  state: string;
  tone: DeviceDot;
  /** What its page failed on, while it is connected and failed. */
  error: string | null;
  /** Connected, and there is a launch to restart it on. */
  canRestart: boolean;
  /** Where it connected from, then its whole user agent. */
  tooltip: string;
}

/**
 * How to get a phone past the warning a certificate signed by this computer
 * brings, and what to check first. Under HTTPS only.
 */
export interface CertificateView {
  /** SHA-256, `AB:CD:…`; `null` until the server runs. */
  fingerprint: string | null;
  /** Its first four groups: enough to compare by eye. `null` until the server runs. */
  fingerprintStart: string | null;
  /** Why a phone warns, and that accepting once is enough. */
  lead: string;
  /** What to tap, in the words each browser uses. */
  steps: string[];
  /** What to compare before accepting on a network not to be trusted; `null` with no fingerprint. */
  check: string | null;
  /** How long an acceptance lasts. */
  lifetime: string;
  /** This start replaced a certificate: phones that had accepted the old one ask again. */
  renewedNote: string | null;
  /** Whether the section opens with the popover: when someone is likely to need it. */
  open: boolean;
}

/** An address whose browser refused the certificate, as the device list says it. */
export interface WaitingDevice {
  address: string;
  label: string;
}

/** The live reload checkbox, and what live reload does in this window now. */
export interface LiveReloadView {
  on: boolean;
  /** Beneath the checkbox; `null` while it is off. */
  note: string | null;
  tone: 'hint' | 'warning';
  /** The checkbox's tooltip: what turning it on does. */
  title: string;
}

/** One entry of the address picker. `''` is the automatic choice. */
export interface AddressOption {
  value: string;
  label: string;
}

export interface DeviceView {
  dot: DeviceDot;
  /** The button's tooltip: what it does, then where devices are served or what is wrong. */
  title: string;
  stateLabel: string;
  /** The current launch's scene; `null` while devices are shown the waiting page. */
  sceneName: string | null;
  /** Why the server could not start. */
  error: string | null;
  /** What a phone opens: `null` unless the server runs with a network address. */
  link: string | null;
  /** What this computer opens, over `localhost`: `null` unless the server runs. */
  localUrl: string | null;
  /** Running with no address but `localhost`: no phone can reach it. */
  noNetwork: boolean;
  addresses: AddressOption[];
  /** The picker's value. */
  address: string;
  addressNote: string | null;
  /** The protocol picker's value: the running server's, the settings' otherwise. */
  transport: DeviceTransport;
  /** What the protocol gives a phone, and what it asks of it. */
  transportNote: string;
  /** Under HTTPS, whether the server runs or not; `null` under HTTP. */
  certificate: CertificateView | null;
  /** Addresses held at the certificate's warning: browsers that refused it, and got no further. */
  waiting: WaitingDevice[];
  /** The port shown: the one listened on while running, the settings' otherwise. */
  port: number;
  /** The settings' port, which *Take Back* moves the server onto. */
  requestedPort: number;
  /** Why the server is not on the port it asked for, after a slide. */
  note: string | null;
  /**
   * Whether *Take Back* is offered: whenever the port slid, since it also
   * moves back to a port that has come free since.
   */
  takeBack: boolean;
  /** What to check when a phone cannot open the link: a lead, then one item each. */
  help: { lead: string; items: string[] };
  /** The devices connected: the number the button shows. */
  count: number;
  /** Every device that said hello since the server started, connected or not. */
  devices: DeviceRow[];
  /** What the list says while the server runs with no device in it. */
  devicesNote: string | null;
  /** Why a row's backend carries a warning mark: not a secure context. */
  insecureNote: string;
  /** Why a secure row's backend carries one: the browser gave no WebGPU. */
  noWebGpuNote: string;
  liveReload: LiveReloadView;
}

export interface DeviceViewContext {
  platform: Platform;
  /** Run from `npm run dev`, where the firewall knows the app as Electron. */
  dev: boolean;
  /** This window's last launch that became current, which live reload follows. */
  ownLaunch: Pick<OwnLaunch, 'id'> | null;
  /** The refusal holding live reload in this window, or `null`. */
  liveReloadRefused: string | null;
}

const LAUNCH = 'Launch on Devices';

const AUTOMATIC: AddressOption = { value: '', label: 'Automatic' };

const BACKEND_LABELS: Readonly<Record<DeviceBackend, string>> = {
  webgpu: 'WebGPU',
  webgl: 'WebGL2',
};

/**
 * A page's state as its row says it. Waiting is green: the link is up, and
 * the page starts the game on the next launch by itself.
 */
const ROW_STATES: Readonly<Record<DeviceState, { label: string; tone: DeviceDot }>> = {
  waiting: { label: 'Waiting', tone: 'running' },
  booting: { label: 'Starting…', tone: 'starting' },
  running: { label: 'Running', tone: 'running' },
  failed: { label: 'Failed', tone: 'error' },
};

const DEVICES_NOTE = 'No device yet. Open the link on a phone: it restarts on every launch.';

const INSECURE_NOTE =
  'Not a secure context, so no WebGPU: browsers allow it only over HTTPS or on localhost.';

const NO_WEBGPU_NOTE = 'A secure page, and still WebGL2: this browser gave the page no WebGPU.';

const TRANSPORT_NOTES: Readonly<Record<DeviceTransport, string>> = {
  http: 'Phones run WebGL2: browsers give WebGPU only to pages served over HTTPS.',
  https: 'Phones get WebGPU. Each one asks once to trust this computer’s certificate.',
};

const LIVE_RELOAD_TITLE = 'Relaunch every device a second after each change.';

function liveReloadNote(state: LiveReloadState, status: DeviceServerStatus | null): string | null {
  switch (state) {
    case 'off':
      return null;
    case 'idle':
      return 'Starts with the next Launch from this window.';
    case 'elsewhere':
      return (
        `“${status?.launch?.sceneName ?? 'Another scene'}” was launched from another window. ` +
        'Launch here to follow this one.'
      );
    case 'paused':
      return 'Paused: the last relaunch was refused. Launch to try again.';
    case 'on':
      return 'Devices relaunch a second after each change — never mid-drag, never during Play.';
  }
}

const STATE_LABELS: Readonly<Record<DeviceServerState, string>> = {
  stopped: 'Stopped',
  starting: 'Starting…',
  running: 'Running',
  error: 'Could not start',
};

function dotOf(status: DeviceServerStatus | null): DeviceDot {
  if (status === null || status.state === 'stopped') return 'none';
  if (status.state === 'running') return hasSlid(status) ? 'slid' : 'running';
  return status.state;
}

/** After a slide, what holds the port asked for. */
function slidNote(status: DeviceServerStatus): string {
  const holder = status.portHolder;
  return holder === null
    ? `${status.requestedPort} is in use by another program.`
    : `${status.requestedPort} is held by ${holderName(holder)}.`;
}

/** `393×852 @3x`, the ratio to two decimals at most: an Android phone's is often `2.625`. */
function screenOf({ width, height, dpr }: DeviceInfo['screen']): string {
  return `${width}×${height} @${Number(dpr.toFixed(2))}x`;
}

function rowOf(device: DeviceInfo, launched: boolean): DeviceRow {
  const running = device.connected && device.state === 'running' && device.backend !== null;
  const backend = running && device.backend !== null ? BACKEND_LABELS[device.backend] : null;
  const known = ROW_STATES[device.state];
  return {
    id: device.id,
    label: deviceLabel(device),
    backend,
    insecure: !device.secureContext,
    noWebGpu: running && device.secureContext && device.backend === 'webgl',
    screen: screenOf(device.screen),
    state: device.connected ? (backend ?? known.label) : 'Offline',
    tone: device.connected ? known.tone : 'none',
    error: device.connected && device.state === 'failed' ? device.error : null,
    canRestart: device.connected && launched,
    tooltip: `Connected from ${device.address}\n${device.userAgent}`,
  };
}

/** The first line of the button's tooltip: what it does, and to how many devices. */
function launchLine(count: number): string {
  if (count === 0) return LAUNCH;
  return `${LAUNCH} — ${count} ${count === 1 ? 'device' : 'devices'}`;
}

/**
 * What the button does, its first line naming live reload while it is on: a
 * click then launches, and every change after it relaunches.
 */
function titleOf(
  status: DeviceServerStatus | null,
  { served, note, count }: { served: string | null; note: string | null; count: number },
): string {
  const live = status?.liveReload === true ? ' — live reload' : '';
  switch (status?.state) {
    case 'starting':
      return `${LAUNCH}${live}\nThe device server is starting…`;
    case 'error':
      return status.error === undefined
        ? `${LAUNCH}${live}\nThe device server could not start.`
        : `${LAUNCH}${live}\nThe device server could not start: ${status.error}`;
    case 'running':
      return [
        `${launchLine(count)}${live}`,
        served,
        note === null ? null : `Served on port ${status.port}: ${note}`,
      ]
        .filter((line) => line !== null)
        .join('\n');
    default:
      return `${LAUNCH}${live}`;
  }
}

/**
 * The picker's options: automatic, then every address a phone can use, with
 * what it is on. Never `localhost`, which only this computer can open. A
 * chosen address the server does not list is offered too, as not connected,
 * so the picker still shows what the settings keep.
 */
function addressOptions(status: DeviceServerStatus | null, running: boolean): AddressOption[] {
  const network = running ? (status?.urls ?? []).filter((url) => url.address !== 'localhost') : [];
  const options = [
    AUTOMATIC,
    ...network.map((url) => ({ value: url.address, label: `${url.address} — ${url.label}` })),
  ];
  const chosen = status?.address ?? null;
  if (chosen !== null && !network.some((url) => url.address === chosen)) {
    options.push({ value: chosen, label: running ? `${chosen} — not connected` : chosen });
  }
  return options;
}

function addressNoteOf(status: DeviceServerStatus | null, link: string | null): string | null {
  const chosen = status?.address ?? null;
  if (status?.state !== 'running' || chosen === null) return null;
  const listed = status.urls.find((url) => url.address === chosen);
  if (listed === undefined) {
    const shown = status.urls.find((url) => url.url === link)?.address;
    return shown === undefined
      ? `${chosen} is not connected.`
      : `${chosen} is not connected. The code shows ${shown} meanwhile.`;
  }
  return listed.label === 'Tailscale'
    ? 'Phones need Tailscale on, in the same tailnet — on Wi-Fi or mobile data.'
    : null;
}

function isLoopback(address: string): boolean {
  return address === '::1' || address.startsWith('127.');
}

/** The host a browser's warning names: the link's, else the address chosen, else a description. */
function warningHost(status: DeviceServerStatus | null, url: string | null): string {
  if (url !== null) return new URL(url).hostname;
  return status?.address ?? 'this computer’s address';
}

function waitingOf(status: DeviceServerStatus | null): WaitingDevice[] {
  return (status?.certificate?.refusedBy ?? []).map((address) => ({
    address,
    label: isLoopback(address)
      ? 'This computer’s browser has not accepted the certificate yet.'
      : `${address} has not accepted the certificate yet.`,
  }));
}

/**
 * What accepting the certificate takes, in each browser's words.
 *
 * Opened with the popover when someone is likely to need it: a browser held at
 * the warning, a certificate made anew, or no device connected yet.
 */
function certificateOf(
  status: DeviceServerStatus | null,
  {
    host,
    running,
    count,
    waiting,
  }: { host: string; running: boolean; count: number; waiting: number },
): CertificateView {
  const fingerprint = status?.certificate?.fingerprint ?? null;
  const fingerprintStart = fingerprint?.split(':').slice(0, 4).join(':') ?? null;
  const renewed = status?.certificate?.renewed === true;
  return {
    fingerprint,
    fingerprintStart,
    lead:
      'Each phone first warns that the connection is not private: this computer signed its own ' +
      'certificate, and no authority vouches for it. Accept it once:',
    steps: [
      'iPhone, Safari: Show Details › visit this website › Visit Website.',
      `Android, Chrome: Advanced › Proceed to ${host} (unsafe).`,
      'Other browsers: the same warning, then Advanced, and continue.',
      'This computer’s browser asks too, the first time Open in Browser uses HTTPS.',
    ],
    check:
      fingerprintStart === null
        ? null
        : 'On a network you do not trust, view the certificate on the phone before accepting: ' +
          `its SHA-256 fingerprint starts with ${fingerprintStart}.`,
    lifetime:
      'Chrome asks again after a week. Every phone asks again when this computer makes a new ' +
      'certificate: on a network it has not served from before, and about once a year.',
    renewedNote: renewed
      ? 'This computer made a new certificate as the server started: phones that had accepted ' +
        'the old one ask again.'
      : null,
    open: running && (waiting > 0 || renewed || count === 0),
  };
}

/**
 * Where each system lets a program through its firewall. `app` is the name the
 * firewall knows it by: from `npm run dev`, Electron is what listens.
 */
function firewallHelp(platform: Platform, app: string, port: number): string {
  switch (platform) {
    case 'darwin':
      return (
        `If macOS asked whether ${app} may accept incoming connections and it was refused, ` +
        'allow it in System Settings › Network › Firewall › Options.'
      );
    case 'win32':
      return (
        `Allow ${app} in Windows Security › Firewall & network protection › Allow an app through ` +
        'firewall, for private networks — and check that this Wi-Fi is private, not public.'
      );
    case 'linux':
      return `If a firewall runs, open TCP port ${port}: with ufw, sudo ufw allow ${port}/tcp.`;
  }
}

/**
 * Led by what the server knows. A firewall refuses without a word, so a server
 * nothing on the network has reached is most likely behind one; once
 * something has, the way in is open and the link is the likelier fault.
 */
function helpOf(
  status: DeviceServerStatus | null,
  { platform, dev }: DeviceViewContext,
  port: number,
): DeviceView['help'] {
  let lead = 'If a phone cannot open the link:';
  if (status?.reachedFromNetwork === true) {
    lead =
      'A device on the network has reached this computer, so the way in is open. ' +
      'Scan the code again, or check the link: the token is case-sensitive.';
  } else if (status?.state === 'running') {
    lead =
      'Nothing on the network has reached this computer yet, so something between the phone ' +
      'and it is in the way:';
  }
  return {
    lead,
    items: [
      'The phone has to be on the same Wi-Fi as this computer, not on mobile data — unless you ' +
        'pick the Tailscale address.',
      firewallHelp(platform, dev ? 'Electron' : 'Three Studio', port),
      'Guest and office networks often stop devices from reaching each other. Connect this ' +
        'computer to the phone’s hotspot and pick the address that appears, or install Tailscale ' +
        'on both and pick the Tailscale address.',
    ],
  };
}

export function deviceView(
  status: DeviceServerStatus | null,
  context: DeviceViewContext,
): DeviceView {
  const running = status?.state === 'running';
  const link = deviceLink(status);
  const localUrl = localDeviceUrl(status);
  const slid = hasSlid(status);
  const note = slid ? slidNote(status) : null;
  const port = status?.port ?? DEFAULT_DEVICE_PORT;
  const error =
    status?.state === 'error' ? (status.error ?? 'The device server could not start.') : null;
  // A stopped server has forgotten every device, whatever a status says.
  const listed = running ? (status?.devices ?? []) : [];
  const launched = running && status?.launch !== null;
  const devices = listed.map((device) => rowOf(device, launched));
  const count = listed.filter((device) => device.connected).length;
  const transport = status?.transport ?? 'http';
  const waiting = waitingOf(status);
  const live = liveReloadState(status, context.ownLaunch, context.liveReloadRefused);

  return {
    dot: dotOf(status),
    title: titleOf(status, { served: link ?? localUrl, note, count }),
    stateLabel: STATE_LABELS[status?.state ?? 'stopped'],
    sceneName: running ? (status?.launch?.sceneName ?? null) : null,
    error,
    link,
    localUrl,
    noNetwork: running && link === null,
    addresses: addressOptions(status, running),
    address: status?.address ?? '',
    addressNote: addressNoteOf(status, link),
    transport,
    transportNote: TRANSPORT_NOTES[transport],
    certificate:
      transport === 'https'
        ? certificateOf(status, {
            host: warningHost(status, link ?? localUrl),
            running,
            count,
            waiting: waiting.length,
          })
        : null,
    waiting,
    port,
    requestedPort: status?.requestedPort ?? port,
    note,
    takeBack: slid,
    help: helpOf(status, context, port),
    count,
    devices,
    devicesNote: running && devices.length === 0 ? DEVICES_NOTE : null,
    insecureNote:
      transport === 'http' ? `${INSECURE_NOTE} Choose HTTPS under Protocol.` : INSECURE_NOTE,
    noWebGpuNote: NO_WEBGPU_NOTE,
    liveReload: {
      on: live !== 'off',
      note: liveReloadNote(live, status),
      tone: live === 'paused' ? 'warning' : 'hint',
      title: LIVE_RELOAD_TITLE,
    },
  };
}
