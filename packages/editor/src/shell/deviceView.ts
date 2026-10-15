import {
  DEFAULT_DEVICE_PORT,
  type DeviceServerState,
  type DeviceServerStatus,
  type Platform,
} from '@three-studio/core';
import { deviceLink, hasSlid, holderName, localDeviceUrl } from '../state/deviceStore';

/*
 * What the device button and its popover say, read from the status alone.
 *
 * Pure, so that every state the server can be in is checked without a DOM:
 * the components only draw what this returns.
 */

/** The dot on the button's icon: nothing while stopped. */
export type DeviceDot = 'none' | 'starting' | 'running' | 'slid' | 'error';

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
  /** The port shown: the one listened on while running, the settings' otherwise. */
  port: number;
  /** Why the server is not on the port it asked for, after a slide. */
  note: string | null;
  /**
   * Whether *Take Back* is offered: whenever the port slid, since it also
   * moves back to a port that has come free since.
   */
  takeBack: boolean;
  /** What to check when a phone cannot open the link: a lead, then one item each. */
  help: { lead: string; items: string[] };
}

export interface DeviceViewContext {
  platform: Platform;
  /** Run from `npm run dev`, where the firewall knows the app as Electron. */
  dev: boolean;
}

const LAUNCH = 'Launch on Devices';

const AUTOMATIC: AddressOption = { value: '', label: 'Automatic' };

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

function titleOf(
  status: DeviceServerStatus | null,
  { served, note }: { served: string | null; note: string | null },
): string {
  switch (status?.state) {
    case 'starting':
      return `${LAUNCH}\nThe device server is starting…`;
    case 'error':
      return status.error === undefined
        ? `${LAUNCH}\nThe device server could not start.`
        : `${LAUNCH}\nThe device server could not start: ${status.error}`;
    case 'running':
      return [LAUNCH, served, note === null ? null : `Served on port ${status.port}: ${note}`]
        .filter((line) => line !== null)
        .join('\n');
    default:
      return LAUNCH;
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

  return {
    dot: dotOf(status),
    title: titleOf(status, { served: link ?? localUrl, note }),
    stateLabel: STATE_LABELS[status?.state ?? 'stopped'],
    sceneName: running ? (status?.launch?.sceneName ?? null) : null,
    error,
    link,
    localUrl,
    noNetwork: running && link === null,
    addresses: addressOptions(status, running),
    address: status?.address ?? '',
    addressNote: addressNoteOf(status, link),
    port,
    note,
    takeBack: slid,
    help: helpOf(status, context, port),
  };
}
