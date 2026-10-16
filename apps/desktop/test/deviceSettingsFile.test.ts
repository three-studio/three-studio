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
    expect(saved).toEqual({
      version: 1,
      port: 7700,
      token: settings.token,
      transport: 'http',
      address: null,
      liveReload: false,
      launchOptions: { forceWebGL: false, maxPixelRatio: null, stats: false },
      screenshotFolders: {},
    });
    expect(isUsableDeviceToken(saved.token)).toBe(true);
  });

  it('rewrites a token that will not do, and nothing else', async () => {
    // A transport a newer build wrote, and a field this one has never heard
    // of: both are somebody's, and both stay exactly as they were.
    const file = await settingsFile(
      JSON.stringify({ version: 1, port: 7801, token: 'short', transport: 'gopher', future: { a: 1 } }),
    );

    const settings = await ensureDeviceSettings(file);

    const saved = await written(file);
    expect(saved).toEqual({
      version: 1,
      port: 7801,
      token: settings.token,
      transport: 'gopher',
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
      address: null,
      liveReload: false,
      launchOptions: { forceWebGL: false, maxPixelRatio: null, stats: false },
      screenshotFolders: {},
    });
  });

  it('reads a file written before live reload existed as off, and leaves it alone', async () => {
    const contents = `{"version":1,"port":7803,"token":"${TOKEN}","transport":"http","address":null}`;
    const file = await settingsFile(contents);

    const settings = await ensureDeviceSettings(file);

    expect(settings.liveReload).toBe(false);
    expect(await readFile(file, 'utf8')).toBe(contents);
  });

  it('reads a file written before launch options existed as the factory’s, and leaves it alone', async () => {
    const contents = `{"version":1,"port":7811,"token":"${TOKEN}","transport":"http","liveReload":true}`;
    const file = await settingsFile(contents);

    const settings = await ensureDeviceSettings(file);

    expect(settings.launchOptions).toEqual({ forceWebGL: false, maxPixelRatio: null, stats: false });
    expect(await readFile(file, 'utf8')).toBe(contents);
  });

  it('reads a file written before screenshots existed as remembering none, and leaves it alone', async () => {
    const contents = `{"version":1,"port":7814,"token":"${TOKEN}","transport":"http","liveReload":true}`;
    const file = await settingsFile(contents);

    const settings = await ensureDeviceSettings(file);

    expect(settings.screenshotFolders).toEqual({});
    expect(await readFile(file, 'utf8')).toBe(contents);
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

  it('changes the address and keeps the token, the port and every other field as found', async () => {
    const file = await settingsFile(
      JSON.stringify({ version: 1, port: 7807, token: TOKEN, transport: 'https', future: { a: 1 } }),
    );

    const settings = await updateDeviceSettings(file, { address: '192.168.1.42' });

    expect(settings.address).toBe('192.168.1.42');
    expect(await written(file)).toEqual({
      version: 1,
      port: 7807,
      token: TOKEN,
      transport: 'https',
      future: { a: 1 },
      address: '192.168.1.42',
    });
  });

  it('changes the transport and keeps every other field as found', async () => {
    const found = {
      version: 1,
      port: 7809,
      token: TOKEN,
      transport: 'http',
      address: '192.168.1.42',
      future: { a: 1 },
    };
    const file = await settingsFile(JSON.stringify(found));

    const settings = await updateDeviceSettings(file, { transport: 'https' });

    expect(settings.transport).toBe('https');
    expect(await written(file)).toEqual({ ...found, transport: 'https' });
  });

  it('turns live reload on and keeps every other field as found', async () => {
    const found = { version: 1, port: 7810, token: TOKEN, transport: 'gopher', future: { a: 1 } };
    const file = await settingsFile(JSON.stringify(found));

    const settings = await updateDeviceSettings(file, { liveReload: true });

    expect(settings.liveReload).toBe(true);
    expect(await written(file)).toEqual({ ...found, liveReload: true });
  });

  it('writes a launch option into the file’s own, and keeps the rest of them as found', async () => {
    // An option a newer build wrote stays: written whole, the options this
    // build knows would take its place.
    const found = {
      version: 1,
      port: 7812,
      token: TOKEN,
      transport: 'http',
      launchOptions: { forceWebGL: true, future: 1 },
    };
    const file = await settingsFile(JSON.stringify(found));

    const settings = await updateDeviceSettings(file, { launchOptions: { stats: true } });

    expect(await written(file)).toEqual({
      ...found,
      launchOptions: { forceWebGL: true, future: 1, stats: true },
    });
    expect(settings.launchOptions).toEqual({ forceWebGL: true, maxPixelRatio: null, stats: true });
  });

  it('writes a launch option alone over launch options that are not an object', async () => {
    const found = { version: 1, port: 7813, token: TOKEN, transport: 'http', launchOptions: 'x' };
    const file = await settingsFile(JSON.stringify(found));

    const settings = await updateDeviceSettings(file, { launchOptions: { maxPixelRatio: 1 } });

    expect(await written(file)).toEqual({ ...found, launchOptions: { maxPixelRatio: 1 } });
    expect(settings.launchOptions).toEqual({ forceWebGL: false, maxPixelRatio: 1, stats: false });
  });

  it('writes a project’s screenshot folder into the file’s own, and keeps every other as found', async () => {
    // Another project's folder stays, and so does an entry this build cannot
    // read: written whole, the map would lose both.
    const found = {
      version: 1,
      port: 7815,
      token: TOKEN,
      transport: 'http',
      screenshotFolders: { '/a': '/x', '/c': 7 },
      future: 1,
    };
    const file = await settingsFile(JSON.stringify(found));

    const settings = await updateDeviceSettings(file, { screenshotFolders: { '/b': '/shots' } });

    expect(await written(file)).toEqual({
      ...found,
      screenshotFolders: { '/a': '/x', '/c': 7, '/b': '/shots' },
    });
    expect(settings.screenshotFolders).toEqual({ '/a': '/x', '/b': '/shots' });
  });

  it('writes a new token alone, as the main process asks it to', async () => {
    const found = { version: 1, port: 7808, token: TOKEN, transport: 'https', future: { a: 1 } };
    const file = await settingsFile(JSON.stringify(found));
    const token = 'ZYXWVUTSRQPONMLKJIHGFE';

    const settings = await updateDeviceSettings(file, { token });

    expect(settings.token).toBe(token);
    expect(await written(file)).toEqual({ ...found, token });
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
      address: null,
      liveReload: false,
      launchOptions: { forceWebGL: false, maxPixelRatio: null, stats: false },
      screenshotFolders: {},
    });
    expect(isUsableDeviceToken(settings.token)).toBe(true);
  });
});
