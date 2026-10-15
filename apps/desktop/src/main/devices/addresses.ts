import type { DeviceTransport, DeviceUrl } from '@three-studio/core';

/*
 * Which addresses the device server names, and which it answers to.
 *
 * Pure, over what `os.networkInterfaces()` and `os.hostname()` return, so that
 * a machine's whole network can be written out by hand in a test.
 */

/** What `os.networkInterfaces()` returns, reduced to the fields read here. */
export type NetworkInterfaces = Readonly<
  Record<
    string,
    readonly { address: string; family: string | number; internal: boolean }[] | undefined
  >
>;

/** An address the server can be reached on, and what to call it. */
export interface ListedAddress {
  address: string;
  /** The interface's name, or `Tailscale`. */
  label: string;
}

/**
 * Interfaces a phone on the same Wi-Fi does not reach: a virtual machine's or a
 * container's bridge, a VPN tunnel, Apple's peer-to-peer links. Their addresses
 * are still listed, after the others, since someone may mean one of them.
 */
const VIRTUAL_INTERFACE =
  /^(?:bridge|vmnet|vboxnet|docker|br-|veth|virbr|utun|awdl|llw|anpi|gif|stf|tun|tap|wg|zt)|vethernet|virtualbox|vmware|hyper-v/i;

/**
 * Tailscale's addresses, `100.64.0.0/10`. Carrier-grade NAT uses the same
 * range, so a computer plugged straight into a carrier's network would be
 * labelled Tailscale too: rare, and the address still works.
 */
function isTailscale(address: string): boolean {
  const [first, second] = address.split('.').map(Number);
  return first === 100 && second !== undefined && second >= 64 && second <= 127;
}

/** `169.254.0.0/16`: what an interface gives itself when no network answered. Nothing can reach it. */
function isLinkLocal(address: string): boolean {
  return address.startsWith('169.254.');
}

/**
 * Every address a device could reach the server on, the likeliest first.
 *
 * IPv4 alone: the URL is typed on a phone or read off a QR code, and a phone on
 * the same Wi-Fi always has an IPv4 path to it. In three groups:
 *
 *  1. the local network — the address a phone beside the computer reaches, and
 *     the one a link is made of unless someone picks another;
 *  2. Tailscale, labelled so: it reaches a phone on mobile data too, but only
 *     one in the same tailnet;
 *  3. the rest, each labelled by its interface.
 *
 * Each group in the order a person counts interfaces in, `en2` before `en10`,
 * so the same machine lists the same way every time.
 */
export function listAddresses(interfaces: NetworkInterfaces): ListedAddress[] {
  const local: [string, string][] = [];
  const tailscale: [string, string][] = [];
  const rest: [string, string][] = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' && entry.family !== 4) continue;
      if (entry.internal || isLinkLocal(entry.address)) continue;
      if (isTailscale(entry.address)) tailscale.push([name, entry.address]);
      else if (VIRTUAL_INTERFACE.test(name)) rest.push([name, entry.address]);
      else local.push([name, entry.address]);
    }
  }
  const byName = (a: [string, string], b: [string, string]): number =>
    a[0].localeCompare(b[0], 'en', { numeric: true });
  return [
    ...local.sort(byName).map(([name, address]) => ({ address, label: name })),
    ...tailscale.sort(byName).map(([, address]) => ({ address, label: 'Tailscale' })),
    ...rest.sort(byName).map(([name, address]) => ({ address, label: name })),
  ];
}

/**
 * The page a device opens, on each address, then on this computer.
 *
 * The scheme is the transport's, never written in: the same server may be
 * asked to speak HTTPS, and every link has to follow it. `localhost` comes last
 * because no phone can use it; it is there for this computer's own browser.
 */
export function deviceUrls(
  addresses: readonly ListedAddress[],
  transport: DeviceTransport,
  port: number,
  token: string,
): DeviceUrl[] {
  return [...addresses, { address: 'localhost', label: 'This computer' }].map(
    ({ address, label }) => ({ address, label, url: `${transport}://${address}:${port}/${token}/` }),
  );
}

/**
 * The link to show first: the chosen address's while it is listed; otherwise
 * the first one a phone can use, else this computer's. `null` with none.
 */
export function selectedUrl(urls: readonly DeviceUrl[], address: string | null): string | null {
  const chosen = address === null ? undefined : urls.find((url) => url.address === address);
  return (chosen ?? urls.find((url) => url.address !== 'localhost') ?? urls[0])?.url ?? null;
}

/** `Host` without its port, in lower case. `[::1]:7700` keeps its brackets. */
function withoutPort(host: string): string {
  const lower = host.trim().toLowerCase();
  if (lower.startsWith('[')) return lower.slice(0, lower.indexOf(']') + 1);
  const colon = lower.lastIndexOf(':');
  return colon === -1 ? lower : lower.slice(0, colon);
}

/**
 * Whether a request's `Host` names this machine.
 *
 * The defence against DNS rebinding: a page on another site can point its own
 * name at this machine's address and have the browser fetch from the server as
 * if it were that site. The browser still sends that site's name in `Host`, so
 * answering only the names this machine goes by — its addresses, `localhost`,
 * its host name and the `.local` name a phone's mDNS resolves — leaves such a
 * page with nothing to read, token or no token.
 *
 * The caller reads the addresses again when a `Host` is not among them: a new
 * Wi-Fi or a new DHCP lease changes them under a running server.
 */
export function isOwnHost(
  host: string | undefined,
  addresses: readonly ListedAddress[],
  hostName: string,
): boolean {
  if (host === undefined) return false;
  const name = withoutPort(host);
  if (name === '') return false;
  if (name === 'localhost' || name === '127.0.0.1' || name === '[::1]') return true;
  if (addresses.some((entry) => entry.address === name)) return true;
  const machine = hostName.toLowerCase();
  return name === machine || name === `${machine.split('.')[0]}.local`;
}

/** An address as a socket gives it: `::ffff:` is an IPv4 address reaching an IPv6 socket. */
export function plainAddress(remote: string): string {
  return remote.startsWith('::ffff:') ? remote.slice('::ffff:'.length) : remote;
}

function isLoopback(address: string): boolean {
  return address === '::1' || address.startsWith('127.');
}

/**
 * Whether a request came from another machine.
 *
 * What says the network reaches the server at all. A firewall that refuses the
 * port does it silently: the phone times out, and nothing on this side of it
 * can tell that from a phone that never tried.
 */
export function isFromOutside(
  remote: string | undefined,
  addresses: readonly ListedAddress[],
): boolean {
  if (remote === undefined) return false;
  const address = plainAddress(remote);
  return !isLoopback(address) && !addresses.some((entry) => entry.address === address);
}
