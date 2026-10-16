import { X509Certificate, createPrivateKey } from 'node:crypto';
import { createServer, get, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  certificateFingerprint,
  certificateNames,
  createCertificate,
  refusesCertificate,
} from '../src/main/devices/certificate';

/*
 * The device server's certificate, written by hand around what `node:crypto`
 * signs, and read back the way a browser reads it: through the platform's own
 * parser, then in a real handshake.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 15, 9, 30, 0);
const NAMES = ['localhost', 'mac.local', '127.0.0.1', '192.168.1.42'];

const made = createCertificate(NAMES, NOW);
const x509 = new X509Certificate(made.certificate);

describe('the certificate', () => {
  it('names every name, in order, DNS names and IP addresses each as such', () => {
    expect(x509.subjectAltName).toBe(
      'DNS:localhost, DNS:mac.local, IP Address:127.0.0.1, IP Address:192.168.1.42',
    );
  });

  it('says what a phone shows when asked to view it', () => {
    expect(x509.subject).toBe('CN=Three Studio device server');
    expect(x509.issuer).toBe(x509.subject);
  });

  it('serves a server, and can vouch for nothing else', () => {
    expect(x509.keyUsage).toEqual(['1.3.6.1.5.5.7.3.1']);
    expect(x509.ca).toBe(false);
  });

  it('is signed with its own P-256 key', () => {
    const key = createPrivateKey(made.key);

    expect(made.key).toMatch(/^-----BEGIN PRIVATE KEY-----\n/);
    expect(key.asymmetricKeyType).toBe('ec');
    expect(key.asymmetricKeyDetails?.namedCurve).toBe('prime256v1');
    expect(x509.verify(x509.publicKey)).toBe(true);
    expect(x509.checkPrivateKey(key)).toBe(true);
  });

  it('is valid from the day before it was made, for 397 days', () => {
    expect(x509.validFromDate.getTime()).toBe(NOW - DAY);
    expect(x509.validToDate.getTime() - x509.validFromDate.getTime()).toBe(397 * DAY);
  });

  it('has a serial number of its own, and a positive one', () => {
    const serials = [made, createCertificate(NAMES, NOW)].map(
      ({ certificate }) => new X509Certificate(certificate).serialNumber,
    );

    expect(serials[0]).not.toBe(serials[1]);
    for (const serial of serials) {
      const value = BigInt(`0x${serial}`);
      expect(value).toBeGreaterThan(0n);
      expect(value).toBeLessThan(1n << 127n);
    }
  });

  it('takes as many names as the server keeps, past the short form of a length', () => {
    const names = Array.from({ length: 32 }, (_, i) =>
      i % 2 === 0 ? `device-${i}.example` : `10.0.${i}.1`,
    );

    expect(certificateNames(createCertificate(names, NOW).certificate)).toEqual(names);
  });

  it('ends in 2050 when made in 2049, which two digits of a year cannot say', () => {
    const made2049 = new X509Certificate(
      createCertificate(NAMES, Date.UTC(2049, 5, 1, 12, 0, 0)).certificate,
    );

    expect(made2049.validFromDate.toISOString()).toBe('2049-05-31T12:00:00.000Z');
    expect(made2049.validToDate.toISOString()).toBe('2050-07-02T12:00:00.000Z');
  });

  it('is read back as the platform reads it', () => {
    expect(certificateNames(made.certificate)).toEqual(NAMES);
    expect(certificateFingerprint(made.certificate)).toBe(x509.fingerprint256);
    expect(certificateFingerprint(made.certificate)).toMatch(/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });
});

describe('in a handshake', () => {
  let server: Server | undefined;

  afterEach(async () => {
    const listening = server;
    server = undefined;
    if (listening !== undefined) await new Promise((resolve) => listening.close(resolve));
  });

  /** A request over TLS that trusts the certificate alone, under the name a browser would check. */
  function status(port: number, name?: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const sent = get(
        {
          host: '127.0.0.1',
          port,
          path: '/',
          ca: made.certificate,
          servername: name,
          agent: false,
        },
        (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        },
      );
      sent.on('error', reject);
    });
  }

  it('is accepted for the names it lists, and for no other', async () => {
    const listening = createServer({ key: made.key, cert: made.certificate }, (_, response) =>
      response.end('ok'),
    );
    server = listening;
    await new Promise<void>((resolve) => listening.listen(0, '127.0.0.1', resolve));
    const { port } = listening.address() as AddressInfo;

    expect(await status(port)).toBe(200);
    expect(await status(port, 'localhost')).toBe(200);
    await expect(status(port, 'elsewhere.example')).rejects.toMatchObject({
      code: 'ERR_TLS_CERT_ALTNAME_INVALID',
    });
  });
});

describe('a refused certificate', () => {
  const failure = (code: string | undefined, message = ''): Error =>
    Object.assign(new Error(message), code === undefined ? {} : { code });

  it.each([
    ['an unknown authority', failure('ERR_SSL_TLSV1_ALERT_UNKNOWN_CA')],
    ['a certificate unknown', failure('ERR_SSL_SSLV3_ALERT_CERTIFICATE_UNKNOWN')],
    ['a bad certificate', failure('ERR_SSL_SSLV3_ALERT_BAD_CERTIFICATE')],
    [
      'the alert in the message alone',
      failure(
        undefined,
        'error:0A000416:SSL routines:ssl3_read_bytes:sslv3 alert certificate unknown:' +
          'ssl/record/rec_layer_s3.c:1605:SSL alert number 46',
      ),
    ],
  ])('is told from %s', (_, error) => {
    expect(refusesCertificate(error)).toBe(true);
  });

  it.each([
    // A reset is also what a port scanner leaves, and what some clients do
    // instead of saying why.
    ['a reset', failure('ECONNRESET')],
    // Plain HTTP sent to the HTTPS port: a link from before a switch.
    ['plain HTTP', failure('ERR_SSL_HTTP_REQUEST')],
    ['a wrong version', failure('ERR_SSL_WRONG_VERSION_NUMBER')],
    ['a bad packet', failure('ERR_SSL_BAD_PACKET_LENGTH')],
    ['nothing', null],
  ])('is not told from %s', (_, error) => {
    expect(refusesCertificate(error)).toBe(false);
  });
});
