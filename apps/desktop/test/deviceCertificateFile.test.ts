import { X509Certificate, createPrivateKey } from 'node:crypto';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { certificateNames, createCertificate } from '../src/main/devices/certificate';
import {
  CERTIFICATE_VERSION,
  ensureDeviceCertificate,
} from '../src/main/devices/certificateFile';

/*
 * `device-certificate.json`. Every certificate made anew is a warning again on
 * every phone that had accepted the last one, so each test checks when one is
 * made as much as what it names.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 15, 9, 30, 0);
const NAMES = ['localhost', 'mac.local', '127.0.0.1', '192.168.1.42'];

async function certificateFile(contents?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'studio-certificate-'));
  const file = join(dir, 'device-certificate.json');
  if (contents !== undefined) await writeFile(file, contents, 'utf8');
  return file;
}

async function written(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
}

/** A file as this build writes one, with a certificate made at `NOW`. */
function saved(names: readonly string[], fields: Record<string, unknown> = {}): string {
  const made = createCertificate(names, NOW);
  return JSON.stringify({ version: CERTIFICATE_VERSION, ...made, ...fields });
}

const fingerprintOf = (contents: string): string =>
  new X509Certificate(JSON.parse(contents).certificate as string).fingerprint256;

describe('with no certificate yet', () => {
  it('makes one for the names, and keeps it', async () => {
    const file = await certificateFile();

    const made = await ensureDeviceCertificate(file, NAMES, NOW);

    expect(made.kept).toBe(false);
    expect(made.renewed).toBe(false);
    expect(made.names).toEqual(NAMES);
    expect(made.fingerprint).toBe(new X509Certificate(made.certificate).fingerprint256);
    expect(new X509Certificate(made.certificate).validFromDate.getTime()).toBe(NOW - DAY);
    expect(await written(file)).toEqual({
      version: CERTIFICATE_VERSION,
      key: made.key,
      certificate: made.certificate,
    });
  });

  // Windows has no such bits: the user profile's permissions do that work there.
  it.skipIf(process.platform === 'win32')('keeps it where only this user can read it', async () => {
    const file = await certificateFile();

    await ensureDeviceCertificate(file, NAMES, NOW);

    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });
});

describe('a certificate kept', () => {
  it('serves the same names again, and the file is left alone', async () => {
    const file = await certificateFile();
    const first = await ensureDeviceCertificate(file, NAMES, NOW);
    const contents = await readFile(file, 'utf8');
    const before = await stat(file);

    const again = await ensureDeviceCertificate(file, NAMES, NOW + DAY);

    expect(again.fingerprint).toBe(first.fingerprint);
    expect(again.kept).toBe(true);
    expect(again.renewed).toBe(false);
    expect(await readFile(file, 'utf8')).toBe(contents);
    expect((await stat(file)).mtimeMs).toBe(before.mtimeMs);
  });

  it('still lists a name no longer needed', async () => {
    // The network left today is the one served from tomorrow.
    const contents = saved(NAMES);
    const file = await certificateFile(contents);

    const kept = await ensureDeviceCertificate(file, ['localhost', '127.0.0.1'], NOW);

    expect(kept.renewed).toBe(false);
    expect(kept.fingerprint).toBe(fingerprintOf(contents));
    expect(kept.names).toEqual(NAMES);
  });

  it('serves a month and a day before its end', async () => {
    const contents = saved(NAMES);
    const end = new X509Certificate(JSON.parse(contents).certificate as string).validToDate;
    const file = await certificateFile(contents);

    const kept = await ensureDeviceCertificate(file, NAMES, end.getTime() - 31 * DAY);

    expect(kept.renewed).toBe(false);
    expect(await readFile(file, 'utf8')).toBe(contents);
  });

  it('is used as it is when a newer build wrote it', async () => {
    // A downgrade must not make every phone accept again for a certificate
    // that still serves.
    const contents = saved(NAMES, { version: CERTIFICATE_VERSION + 1 });
    const file = await certificateFile(contents);

    const kept = await ensureDeviceCertificate(file, NAMES, NOW);

    expect(kept.renewed).toBe(false);
    expect(await readFile(file, 'utf8')).toBe(contents);
  });
});

describe('a certificate made again', () => {
  it('names a new address first, then every name of the one it replaces', async () => {
    const contents = saved(NAMES);
    const file = await certificateFile(contents);
    const needed = ['localhost', 'mac.local', '127.0.0.1', '10.0.0.7'];

    const made = await ensureDeviceCertificate(file, needed, NOW);

    expect(made.kept).toBe(false);
    expect(made.renewed).toBe(true);
    expect(made.fingerprint).not.toBe(fingerprintOf(contents));
    expect(made.names).toEqual([...needed, '192.168.1.42']);
    expect(certificateNames((await written(file)).certificate as string)).toEqual(made.names);
  });

  it('keeps 32 names, letting the oldest go', async () => {
    const old = Array.from({ length: 30 }, (_, i) => `10.0.0.${i + 1}`);
    const file = await certificateFile(saved(old));
    const needed = Array.from({ length: 10 }, (_, i) => `192.168.1.${i + 1}`);

    const made = await ensureDeviceCertificate(file, needed, NOW);

    expect(made.names).toEqual([...needed, ...old.slice(0, 22)]);
  });

  it('is made a month before the end of the last one', async () => {
    const contents = saved(NAMES);
    const end = new X509Certificate(JSON.parse(contents).certificate as string).validToDate;
    const file = await certificateFile(contents);

    const made = await ensureDeviceCertificate(file, NAMES, end.getTime() - 29 * DAY);

    expect(made.renewed).toBe(true);
    expect(new X509Certificate(made.certificate).validToDate.getTime()).toBeGreaterThan(
      end.getTime(),
    );
  });

  it('replaces one from an older profile', async () => {
    const file = await certificateFile(saved(NAMES, { version: 0 }));

    const made = await ensureDeviceCertificate(file, NAMES, NOW);

    expect(made.renewed).toBe(true);
    expect((await written(file)).version).toBe(CERTIFICATE_VERSION);
  });

  it.each([
    [
      'a key from another certificate',
      JSON.stringify({
        version: CERTIFICATE_VERSION,
        key: createCertificate(NAMES, NOW).key,
        certificate: createCertificate(NAMES, NOW).certificate,
      }),
    ],
    [
      'a certificate that does not parse',
      JSON.stringify({
        version: CERTIFICATE_VERSION,
        key: createCertificate(NAMES, NOW).key,
        certificate: '-----BEGIN CERTIFICATE-----\nbm90IG9uZQ==\n-----END CERTIFICATE-----\n',
      }),
    ],
    ['a key that is not one', saved(NAMES, { key: 'secret' })],
    ['broken JSON', '{"version":1,"key":'],
    ['JSON that is not an object', '[1, 2]'],
  ])('replaces %s with one that serves', async (_, contents) => {
    const file = await certificateFile(contents);

    const made = await ensureDeviceCertificate(file, NAMES, NOW);

    const found = await written(file);
    expect(found.key).toBe(made.key);
    expect(found.certificate).toBe(made.certificate);
    expect(new X509Certificate(made.certificate).checkPrivateKey(createPrivateKey(made.key))).toBe(
      true,
    );
    expect(made.names).toEqual(NAMES);
  });

  it('keeps a field it does not know, exactly as found', async () => {
    const file = await certificateFile(saved(NAMES, { version: 0, future: { a: [1, 'b'] } }));

    await ensureDeviceCertificate(file, NAMES, NOW);

    expect((await written(file)).future).toEqual({ a: [1, 'b'] });
  });
});
