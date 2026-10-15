import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isUsableDeviceToken } from '@three-studio/core';
import { describe, expect, it } from 'vitest';
import {
  ensureDeviceSettings,
  readDeviceSettings,
  updateDeviceSettings,
} from '../src/main/devices/settingsFile';

/*
 * `devices.json`, which outlives every project: a phone's bookmark names its
 * port and its token, so a file rewritten for no reason is a bookmark broken
 * for no reason. Each test checks what was written as much as what was read.
 */

async function settingsFile(contents?: string): Promise<string> {
  const file = join(await mkdtemp(join(tmpdir(), 'studio-devices-')), 'devices.json');
  if (contents !== undefined) await writeFile(file, contents, 'utf8');
  return file;
}

async function written(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
}

const TOKEN = 'abcdefghijKLMNOPQRST_-0123';

describe('at start', () => {
  it('writes the factory’s settings when there is no file', async () => {
    const file = await settingsFile();

    const settings = await ensureDeviceSettings(file);

    const saved = await written(file);
    expect(saved).toEqual({ version: 1, port: 7700, token: settings.token, transport: 'http' });
    expect(isUsableDeviceToken(saved.token)).toBe(true);
  });

  it('rewrites a token that will not do, and nothing else', async () => {
    // A transport a newer build wrote, and a field this one has never heard
    // of: both are somebody's, and both stay exactly as they were.
    const file = await settingsFile(
      JSON.stringify({ version: 1, port: 7801, token: 'short', transport: 'https', future: { a: 1 } }),
    );

    const settings = await ensureDeviceSettings(file);

    const saved = await written(file);
    expect(saved).toEqual({
      version: 1,
      port: 7801,
      token: settings.token,
      transport: 'https',
      future: { a: 1 },
    });
    expect(isUsableDeviceToken(saved.token)).toBe(true);
    // What the server runs on is what it can serve.
    expect(settings.transport).toBe('http');
    expect(settings.port).toBe(7801);
  });

  it('leaves a complete file alone, to the byte', async () => {
    const contents = `{"version":1,"port":7802,"token":"${TOKEN}","transport":"http"}`;
    const file = await settingsFile(contents);
    const before = await stat(file);

    const settings = await ensureDeviceSettings(file);

    expect(settings.token).toBe(TOKEN);
    expect(settings.port).toBe(7802);
    expect(await readFile(file, 'utf8')).toBe(contents);
    expect((await stat(file)).mtimeMs).toBe(before.mtimeMs);
  });

  it('starts over from the factory when the file is not JSON', async () => {
    const file = await settingsFile('{ "port": 78');

    const settings = await ensureDeviceSettings(file);

    expect(settings.port).toBe(7700);
    expect(await written(file)).toEqual({
      version: 1,
      port: 7700,
      token: settings.token,
      transport: 'http',
    });
  });
});

describe('for the status of a stopped server', () => {
  it('reads without creating anything', async () => {
    const file = await settingsFile();

    const settings = await readDeviceSettings(file);

    expect(settings.port).toBe(7700);
    expect(settings.transport).toBe('http');
    await expect(stat(file)).rejects.toThrow();
  });

  it('reads the port the file keeps', async () => {
    const file = await settingsFile(JSON.stringify({ port: 7803, token: TOKEN }));

    const settings = await readDeviceSettings(file);

    expect(settings.port).toBe(7803);
    expect(settings.token).toBe(TOKEN);
  });
});

describe('a patch', () => {
  it('changes the port and keeps every other field as found', async () => {
    const file = await settingsFile(
      JSON.stringify({ version: 1, port: 7700, token: TOKEN, transport: 'https', future: [1, 2] }),
    );

    const settings = await updateDeviceSettings(file, { port: 7804 });

    expect(settings.port).toBe(7804);
    expect(await written(file)).toEqual({
      version: 1,
      port: 7804,
      token: TOKEN,
      transport: 'https',
      future: [1, 2],
    });
  });

  it('writes nothing when there is nothing in it', async () => {
    const contents = `{"version":1,"port":7806,"token":"${TOKEN}","transport":"http"}`;
    const file = await settingsFile(contents);

    const settings = await updateDeviceSettings(file, {});

    expect(settings.port).toBe(7806);
    expect(await readFile(file, 'utf8')).toBe(contents);
  });

  it('lands over the factory’s settings when there was no file', async () => {
    const file = await settingsFile();

    const settings = await updateDeviceSettings(file, { port: 7805 });

    expect(await written(file)).toEqual({
      version: 1,
      port: 7805,
      token: settings.token,
      transport: 'http',
    });
    expect(isUsableDeviceToken(settings.token)).toBe(true);
  });
});
