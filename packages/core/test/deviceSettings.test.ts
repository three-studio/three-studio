import {
  DEFAULT_DEVICE_PORT,
  DEVICE_SETTINGS_VERSION,
  conformDeviceSettings,
  conformDeviceSettingsPatch,
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
});

describe('what a server runs on', () => {
  it('fills what is missing from the factory', () => {
    const settings = conformDeviceSettings({ port: 7800 });

    expect(settings.port).toBe(7800);
    expect(settings.version).toBe(1);
    expect(settings.transport).toBe('http');
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

  it('serves only a transport this build knows', () => {
    // A newer build may have written another one into the file; this one runs
    // what it can serve, and the file keeps what it said.
    expect(conformDeviceSettings({ transport: 'https' }).transport).toBe('http');
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
});
