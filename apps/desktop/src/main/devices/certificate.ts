import { X509Certificate, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

/*
 * The device server's own certificate, for HTTPS on the local network.
 *
 * No authority signs for `192.168.1.42`, so the server signs for itself and
 * each browser is asked, once, to accept it. Node makes the key and signs with
 * it, but nothing in Node writes a certificate: the envelope around the
 * signature is written here, in DER, by hand. It takes a few ASN.1 shapes and
 * nothing more, which is less to carry than the alternatives — the libraries
 * that write certificates bring an ASN.1 stack of some twenty packages, or a
 * parser with a history of CVEs, and the system's `openssl` is not there on
 * Windows.
 */

/** What a phone shows as the certificate's name, and as who signed it. */
const COMMON_NAME = 'Three Studio device server';

const DAY = 24 * 60 * 60 * 1000;

/**
 * How long a certificate lasts. Apple refuses any TLS server certificate valid
 * for more than 825 days; Chromium's shorter limits bind publicly trusted
 * certificates only. A year and a month is renewed in passing, a month ahead.
 */
const VALIDITY_DAYS = 397;

// The object identifiers written here.
const ECDSA_WITH_SHA256 = '1.2.840.10045.4.3.2';
const COMMON_NAME_ATTRIBUTE = '2.5.4.3';
const BASIC_CONSTRAINTS = '2.5.29.19';
const EXTENDED_KEY_USAGE = '2.5.29.37';
const SUBJECT_ALT_NAME = '2.5.29.17';
const SERVER_AUTH = '1.3.6.1.5.5.7.3.1';

function concat(...parts: Uint8Array[]): Uint8Array {
  return Buffer.concat(parts);
}

/** A length: one byte up to 127; past that, a byte saying how many bytes follow. */
function length(count: number): Uint8Array {
  if (count < 0x80) return Uint8Array.of(count);
  const bytes: number[] = [];
  for (let rest = count; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256);
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

/** One element: its tag, its length, its contents. */
function element(tag: number, contents: Uint8Array): Uint8Array {
  return concat(Uint8Array.of(tag), length(contents.length), contents);
}

const sequence = (...items: Uint8Array[]): Uint8Array => element(0x30, concat(...items));
const set = (...items: Uint8Array[]): Uint8Array => element(0x31, concat(...items));
const octetString = (bytes: Uint8Array): Uint8Array => element(0x04, bytes);
const utf8String = (text: string): Uint8Array => element(0x0c, Buffer.from(text, 'utf8'));
const TRUE = element(0x01, Uint8Array.of(0xff));
/** Whole bytes only: the leading byte counts the unused bits at the end, none. */
const bitString = (bytes: Uint8Array): Uint8Array =>
  element(0x03, concat(Uint8Array.of(0), bytes));
/** `[n]`, wrapped around what it tags rather than replacing its tag. */
const explicit = (tag: number, inner: Uint8Array): Uint8Array => element(0xa0 | tag, inner);
const ascii = (text: string): Uint8Array => Buffer.from(text, 'latin1');

/**
 * A non-negative integer from its big-endian bytes, in as few bytes as DER
 * allows: no leading zero, unless the next byte's high bit would otherwise
 * make the number read as negative.
 */
function integer(bytes: Uint8Array): Uint8Array {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start += 1;
  const trimmed = bytes.subarray(start);
  return element(0x02, (trimmed[0] ?? 0) >= 0x80 ? concat(Uint8Array.of(0), trimmed) : trimmed);
}

/**
 * An object identifier, from its dotted form: the first two arcs are written as
 * one number, and every number in base 128.
 */
function objectIdentifier(dotted: string): Uint8Array {
  const [first = 0, second = 0, ...rest] = dotted.split('.').map(Number);
  const bytes: number[] = [];
  for (const arc of [first * 40 + second, ...rest]) {
    const digits = [arc % 128];
    for (let high = Math.floor(arc / 128); high > 0; high = Math.floor(high / 128)) {
      digits.unshift(0x80 | (high % 128));
    }
    bytes.push(...digits);
  }
  return element(0x06, Uint8Array.from(bytes));
}

/**
 * A moment, to the second. `UTCTime` gives the year two digits, so from 2050
 * on it would read as 1950: RFC 5280 has `GeneralizedTime` take over there.
 */
function time(at: number): Uint8Array {
  const date = new Date(at);
  const digits = date.toISOString().slice(0, 19).replace(/[-T:]/g, '');
  return date.getUTCFullYear() < 2050
    ? element(0x17, ascii(`${digits.slice(2)}Z`))
    : element(0x18, ascii(`${digits}Z`));
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * A name as the subject alternative name lists it, the only place a browser
 * looks for one: an address as its four bytes (`iPAddress`, `[7]`), anything
 * else as a DNS name (`dNSName`, `[2]`).
 */
function alternativeName(name: string): Uint8Array {
  const octets = IPV4.exec(name)?.slice(1).map(Number);
  return octets !== undefined && octets.every((octet) => octet <= 255)
    ? element(0x87, Uint8Array.from(octets))
    : element(0x82, ascii(name));
}

/** An extension; one that is not critical leaves the flag out, as DER drops a default. */
function extension(id: string, critical: boolean, value: Uint8Array): Uint8Array {
  const flag = critical ? [TRUE] : [];
  return sequence(objectIdentifier(id), ...flag, octetString(value));
}

/**
 * A self-signed certificate for these names, and its key, both in PEM.
 *
 * What goes in is what a browser checks and nothing more:
 *
 * - an ECDSA P-256 key, signed with SHA-256: fast to make, and taken by every
 *   browser concerned;
 * - valid from the day before `now`, since a phone whose clock runs behind the
 *   computer's must not find a certificate from the future;
 * - not an authority, so that nothing can make it vouch for another name;
 * - for a TLS server, which Apple requires to be said;
 * - no key usage at all. BoringSSL, which Electron runs, will not take a
 *   self-signed certificate as its own authority when a key usage leaves out
 *   `keyCertSign`, and a TLS server needs none.
 */
export function createCertificate(
  names: readonly string[],
  now: number,
): { key: string; certificate: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const serial = randomBytes(16);
  // Made positive: a serial number is a signed integer, and a negative one is
  // refused by the stricter parsers.
  serial[0] = (serial[0] ?? 0) & 0x7f;
  const from = now - DAY;
  const name = sequence(
    set(sequence(objectIdentifier(COMMON_NAME_ATTRIBUTE), utf8String(COMMON_NAME))),
  );
  const algorithm = sequence(objectIdentifier(ECDSA_WITH_SHA256));
  const signed = sequence(
    explicit(0, integer(Uint8Array.of(2))), // version 3
    integer(serial),
    algorithm,
    name,
    sequence(time(from), time(from + VALIDITY_DAYS * DAY)),
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
    explicit(
      3,
      sequence(
        // Empty: `cA` defaults to false, and DER leaves a default out.
        extension(BASIC_CONSTRAINTS, true, sequence()),
        extension(EXTENDED_KEY_USAGE, false, sequence(objectIdentifier(SERVER_AUTH))),
        extension(SUBJECT_ALT_NAME, false, sequence(...names.map(alternativeName))),
      ),
    ),
  );
  const certificate = sequence(signed, algorithm, bitString(sign('sha256', signed, privateKey)));
  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    certificate: new X509Certificate(certificate).toString(),
  };
}

/**
 * The names a certificate lists, in order: `localhost`, `192.168.1.42`.
 *
 * Read from Node's own rendering, `DNS:localhost, IP Address:192.168.1.42`,
 * which quotes a name only when it holds a comma, a quote or a control
 * character — none of which a host name or an address can.
 */
export function certificateNames(certificate: string): string[] {
  const listed = new X509Certificate(certificate).subjectAltName ?? '';
  return listed
    .split(', ')
    .flatMap((entry) => /^(?:DNS|IP Address):(.+)$/.exec(entry)?.slice(1) ?? []);
}

/** The SHA-256 fingerprint, `AB:CD:…`: what a phone shows, and what a person compares. */
export function certificateFingerprint(certificate: string): string {
  return new X509Certificate(certificate).fingerprint256;
}

/** The TLS alerts a browser ends a handshake with when it does not accept the certificate. */
const REFUSED = new RegExp(
  `ALERT_(?:${[
    'BAD_CERTIFICATE',
    'UNSUPPORTED_CERTIFICATE',
    'CERTIFICATE_REVOKED',
    'CERTIFICATE_EXPIRED',
    'CERTIFICATE_UNKNOWN',
    'UNKNOWN_CA',
  ].join('|')})(?![A-Z0-9])`,
);

/**
 * Whether a failed handshake was a browser refusing the certificate.
 *
 * The alert reaches the server as an error whose code names it —
 * `ERR_SSL_TLSV1_ALERT_UNKNOWN_CA` — and whose message spells it in words,
 * `tlsv1 alert unknown ca`, in OpenSSL's spelling and in BoringSSL's alike.
 * Nothing else counts: a reset is also what a port scanner leaves, and plain
 * HTTP sent to the port is a link from before a change of scheme. A browser
 * that refuses without an alert goes unseen; the steps to accept the
 * certificate do not depend on it.
 */
export function refusesCertificate(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return [code, message].some(
    (text) => typeof text === 'string' && REFUSED.test(text.toUpperCase().replace(/ /g, '_')),
  );
}
