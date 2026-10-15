import {
  DEFAULT_DEVICE_PORT,
  DEVICE_SETTINGS_VERSION,
  conformDeviceSettings,
  conformDeviceSettingsPatch,
  createDeviceLaunchOptions,
  createDeviceSettings,
  isUsableDeviceToken,
} from '@three-studio/core';
import { describe, expect, it } from 'vitest';

/*
 * The device server's settings: a port a phone's bookmark names, and the token
 * that is the only thing standing between the network and the project.
 *
 * They are read from a file a person can edit by hand, and patched by the
 * renderer, so every value below that is not the factory's is deliberately
 * wrong somewhere.
 */

describe('the factory', () => {
  it('serves plain HTTP on port 7700, behind a fresh 22-character token', () => {
    const settings = createDeviceSettings();

    expect(settings.version).toBe(DEVICE_SETTINGS_VERSION);
    expect(settings.version).toBe(1);
    expect(settings.port).toBe(DEFAULT_DEVICE_PORT);
    expect(settings.port).toBe(7700);
    expect(settings.transport).toBe('http');
    expect(settings.token).toHaveLength(22);
    expect(isUsableDeviceToken(settings.token)).toBe(true);
  });

  it('never gives two machines the same token', () => {
    expect(createDeviceSettings().token).not.toBe(createDeviceSettings().token);
  });

  it('leaves the link’s address to the server', () => {
    expect(createDeviceSettings().address).toBeNull();
  });

  it('leaves live reload off: devices restart only when someone launches', () => {
    expect(createDeviceSettings().liveReload).toBe(false);
  });

  it('launches every device as the project says: nothing forced, its pixel ratio, no stats', () => {
    expect(createDeviceSettings().launchOptions).toEqual({
      forceWebGL: false,
      maxPixelRatio: null,
      stats: false,
    });
    expect(createDeviceLaunchOptions()).toEqual(createDeviceSettings().launchOptions);
  });

  it('remembers no screenshot folder: each project starts in its own', () => {
    expect(createDeviceSettings().screenshotFolders).toEqual({});
  });
});

describe('what a server runs on', () => {
  it('fills what is missing from the factory', () => {
    const settings = conformDeviceSettings({ port: 7800 });

    expect(settings.port).toBe(7800);
    expect(settings.version).toBe(1);
    expect(settings.transport).toBe('http');
    expect(settings.address).toBeNull();
    expect(isUsableDeviceToken(settings.token)).toBe(true);
    expect(conformDeviceSettings(null).port).toBe(7700);
  });

  it('keeps a usable token', () => {
    const token = 'abcdefghijKLMNOPQRST_-0123';

    expect(conformDeviceSettings({ token }).token).toBe(token);
  });

  it.each([
    ['too short', 'abc'],
    ['a number', 1234567890],
    ['holding a slash', 'abcdefghij/LMNOPQRST0123'],
  ])('replaces a token %s', (_why, token) => {
    const settings = conformDeviceSettings({ token });

    expect(settings.token).not.toBe(token);
    expect(isUsableDeviceToken(settings.token)).toBe(true);
  });

  it.each([0, 70000, 7.5, '7700'])('gives port %j the factory’s', (port) => {
    expect(conformDeviceSettings({ port }).port).toBe(7700);
  });

  it('keeps HTTPS', () => {
    expect(conformDeviceSettings({ transport: 'https' }).transport).toBe('https');
  });

  it.each(['ftp', 3])('serves %j as plain HTTP', (transport) => {
    // A newer build may have written another one into the file; this one runs
    // what it can serve, and the file keeps what it said.
    expect(conformDeviceSettings({ transport }).transport).toBe('http');
  });

  it.each(['192.168.1.42', '100.101.102.103'])('keeps the address %s', (address) => {
    expect(conformDeviceSettings({ address }).address).toBe(address);
  });

  it.each(['en0', '300.1.2.3', '1.2.3', 3])('reads the address %j as no choice at all', (address) => {
    // An interface's name, an octet out of range, an address cut short, a
    // number: none of them is an address the server could list, so the link
    // is chosen as if nobody had picked one.
    expect(conformDeviceSettings({ address }).address).toBeNull();
  });

  it('keeps live reload on', () => {
    expect(conformDeviceSettings({ liveReload: true }).liveReload).toBe(true);
    expect(conformDeviceSettings({ port: 7800 }).liveReload).toBe(false);
  });

  it.each(['yes', 1])('reads live reload %j as off', (liveReload) => {
    expect(conformDeviceSettings({ liveReload }).liveReload).toBe(false);
  });

  it('keeps the launch options, and fills what is missing from their factory', () => {
    expect(
      conformDeviceSettings({ launchOptions: { forceWebGL: true, maxPixelRatio: 1.5 } }).launchOptions,
    ).toEqual({ forceWebGL: true, maxPixelRatio: 1.5, stats: false });
    expect(conformDeviceSettings({ launchOptions: 'x' }).launchOptions).toEqual(
      createDeviceLaunchOptions(),
    );
  });

  it.each([0.5, 7, '2', NaN])('reads a pixel-ratio cap of %j as the project’s', (maxPixelRatio) => {
    // A `null` field takes a string anywhere else at the boundary, so the cap
    // needs a check of its own; a number out of the project's own range would
    // draw a phone in a way no export ever could.
    expect(conformDeviceSettings({ launchOptions: { maxPixelRatio } }).launchOptions.maxPixelRatio).toBeNull();
  });

  it('keeps each project’s screenshot folder, and drops an entry that names none', () => {
    // A map, which the factory's empty one cannot describe: read entry by entry.
    expect(
      conformDeviceSettings({ screenshotFolders: { '/p': '/p/Screenshots' } }).screenshotFolders,
    ).toEqual({ '/p': '/p/Screenshots' });
    expect(
      conformDeviceSettings({ screenshotFolders: { '/p': '/p/Screenshots', '/q': 3, '/r': '' } })
        .screenshotFolders,
    ).toEqual({ '/p': '/p/Screenshots' });
    expect(conformDeviceSettings({ screenshotFolders: 'x' }).screenshotFolders).toEqual({});
    expect(conformDeviceSettings({ port: 7800 }).screenshotFolders).toEqual({});
  });
});

describe('a patch from the renderer', () => {
  it('keeps a port that can be listened on', () => {
    expect(conformDeviceSettingsPatch({ port: 7800 })).toEqual({ port: 7800 });
  });

  it('never carries the token or the version, and drops a port out of range', () => {
    // The token is the secret a phone's link carries; the renderer is where a
    // project's own scripts run, so it may not choose it.
    expect(
      conformDeviceSettingsPatch({ token: 'abcdefghijKLMNOPQRST_-0123', version: 2, port: 70000 }),
    ).toEqual({});
    expect(conformDeviceSettingsPatch({ port: 0 })).toEqual({});
    expect(conformDeviceSettingsPatch({ port: '7800' })).toEqual({});
    expect(conformDeviceSettingsPatch('port')).toEqual({});
  });

  it('keeps a transport this build serves, and drops anything else', () => {
    expect(conformDeviceSettingsPatch({ transport: 'https' })).toEqual({ transport: 'https' });
    expect(conformDeviceSettingsPatch({ transport: 'http' })).toEqual({ transport: 'http' });
    // Written to the file, a transport no build serves would be read back as
    // plain HTTP anyway: the honest answer is to change nothing.
    expect(conformDeviceSettingsPatch({ transport: 'ftp' })).toEqual({});
    expect(conformDeviceSettingsPatch({ transport: 3 })).toEqual({});
  });

  it('keeps an address, or going back to none, and drops anything else', () => {
    expect(conformDeviceSettingsPatch({ address: '10.0.0.7' })).toEqual({ address: '10.0.0.7' });
    expect(conformDeviceSettingsPatch({ address: null })).toEqual({ address: null });
    // A string is what a `null` field accepts anywhere else at the boundary,
    // so the address needs a check of its own.
    expect(conformDeviceSettingsPatch({ address: 'en0' })).toEqual({});
  });

  it('keeps live reload turned on or off, and drops anything else', () => {
    expect(conformDeviceSettingsPatch({ liveReload: true })).toEqual({ liveReload: true });
    expect(conformDeviceSettingsPatch({ liveReload: false })).toEqual({ liveReload: false });
    expect(conformDeviceSettingsPatch({ liveReload: 'on' })).toEqual({});
  });

  it('keeps the launch options it names, and fills in none it does not', () => {
    // Filled in, an option nobody touched would be written over the file's.
    expect(conformDeviceSettingsPatch({ launchOptions: { forceWebGL: true } })).toEqual({
      launchOptions: { forceWebGL: true },
    });
    expect(conformDeviceSettingsPatch({ launchOptions: { maxPixelRatio: 2.5, stats: true } })).toEqual({
      launchOptions: { maxPixelRatio: 2.5, stats: true },
    });
    expect(conformDeviceSettingsPatch({ launchOptions: { maxPixelRatio: null } })).toEqual({
      launchOptions: { maxPixelRatio: null },
    });
  });

  it('never names a screenshot folder: the main process writes them as it saves', () => {
    expect(conformDeviceSettingsPatch({ screenshotFolders: { '/p': '/elsewhere' } })).toEqual({});
  });

  it('drops launch options that change nothing it knows', () => {
    expect(conformDeviceSettingsPatch({ launchOptions: { maxPixelRatio: 9 } })).toEqual({});
    expect(conformDeviceSettingsPatch({ launchOptions: { maxPixelRatio: '2' } })).toEqual({});
    expect(conformDeviceSettingsPatch({ launchOptions: { stats: 'on', future: 1 } })).toEqual({});
    expect(conformDeviceSettingsPatch({ launchOptions: 'x' })).toEqual({});
  });
});
