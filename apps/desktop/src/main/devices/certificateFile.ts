import { X509Certificate, createPrivateKey } from 'node:crypto';
import { atomicWrite } from '../atomicWrite';
import { certificateFingerprint, certificateNames, createCertificate } from './certificate';
import { readFound } from './settingsFile';

/*
 * `device-certificate.json`, beside `devices.json` in the app's data directory.
 *
 * A browser remembers that it was told to accept a certificate by the
 * certificate itself, so a new one is a warning again on every phone, on every
 * address. A certificate is therefore made as seldom as it can be: at a start,
 * never while running, and only when the one kept will not do. The new one
 * names the names needed now, then every name of the one it replaces — after a
 * first start at home, at the office and on Tailscale, it names all three, and
 * nothing is made again until it nears its end. What that costs: whoever
 * reaches the port can read which private addresses this computer served from
 * before, which says nothing about how to reach them.
 *
 * The file holds the private key, and is written for this user alone. Whoever
 * reads it can pass for this computer, to a phone that accepted the
 * certificate, under the names it lists, until it expires — and for nothing
 * else, since the certificate cannot vouch for another. Deleting the file makes
 * a new one at the next start.
 */

/**
 * The certificate's profile: what `createCertificate` puts in one. A build that
 * makes certificates differently raises it, and a file from an older profile is
 * made again.
 */
export const CERTIFICATE_VERSION = 1;

/** The names a certificate keeps at most, the oldest let go first. */
const MAX_NAMES = 32;

/**
 * A certificate this close to its end is made again at a start, rather than
 * lapse under a phone halfway through a session.
 */
const RENEW_WITHIN = 30 * 24 * 60 * 60 * 1000;

export interface ServerCertificate {
  /** PKCS#8, PEM. */
  key: string;
  /** PEM. */
  certificate: string;
  /** SHA-256, `AB:CD:…`. */
  fingerprint: string;
  /** Every name the certificate lists, in order. */
  names: string[];
  /** Whether the certificate found was kept, rather than a new one written. */
  kept: boolean;
  /** Whether this call replaced a certificate that phones may have accepted. */
  renewed: boolean;
}

/** The certificate the file holds, when it is one; `null` for anything else. */
function parsed(certificate: unknown): X509Certificate | null {
  try {
    return typeof certificate === 'string' ? new X509Certificate(certificate) : null;
  } catch {
    return null;
  }
}

/** Whether the key found is the certificate's own. */
function isOwnKey(held: X509Certificate, key: string): boolean {
  try {
    return held.checkPrivateKey(createPrivateKey(key));
  } catch {
    return false;
  }
}

/**
 * The certificate a server starts with: the one in the file while it serves
 * every name needed, written anew otherwise.
 *
 * One is kept when its key is its own, its profile is this build's or a newer
 * one's — a downgrade must not cost every phone a warning for a certificate
 * that still serves —, more than a month remains before its end, and it lists
 * every name needed. A name it lists and no longer needs is no reason: the
 * network left today is the one served from tomorrow.
 *
 * A new one is written over the file as found, so a field a newer build added
 * stays exactly as it was.
 */
export async function ensureDeviceCertificate(
  file: string,
  needed: readonly string[],
  now = Date.now(),
): Promise<ServerCertificate> {
  const found = (await readFound(file)) ?? {};
  const { key, certificate, version } = found;
  const held = parsed(certificate);
  const heldNames = held === null ? [] : certificateNames(held.toString());
  if (
    held !== null &&
    typeof certificate === 'string' &&
    typeof key === 'string' &&
    isOwnKey(held, key) &&
    typeof version === 'number' &&
    version >= CERTIFICATE_VERSION &&
    held.validToDate.getTime() - now > RENEW_WITHIN &&
    needed.every((name) => heldNames.includes(name))
  ) {
    const fingerprint = held.fingerprint256;
    return { key, certificate, fingerprint, names: heldNames, kept: true, renewed: false };
  }
  // Every name needed now, even past the limit: a certificate that left one out
  // would be made again at every start.
  const names = [...new Set([...needed, ...heldNames])].slice(
    0,
    Math.max(MAX_NAMES, new Set(needed).size),
  );
  const made = createCertificate(names, now);
  await atomicWrite(
    file,
    JSON.stringify({ ...found, version: CERTIFICATE_VERSION, ...made }, null, 2),
    { mode: 0o600 },
  );
  return {
    ...made,
    fingerprint: certificateFingerprint(made.certificate),
    names,
    kept: false,
    renewed: held !== null,
  };
}
