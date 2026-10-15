import { readFile } from 'node:fs/promises';
import {
  conformDeviceSettings,
  createDeviceSettings,
  createDeviceToken,
  isUsableDeviceToken,
  type DeviceSettings,
  type DeviceSettingsPatch,
} from '@three-studio/core';
import { atomicWrite } from '../atomicWrite';

/*
 * `devices.json`, in the app's data directory.
 *
 * A phone's bookmark names the port and the token in this file, so it is
 * written as little as possible: once when there is none, the token alone when
 * it will not do, and a patch over what was found. Never the whole file from
 * what this build understands — unlike `layouts.json`, which starts over when
 * its version changes — because a field a newer build wrote, or a transport it
 * can serve and this one cannot, is somebody's setting, and a downgrade must
 * not take it.
 */

/** What the file holds, when it holds a JSON object; `null` when there is none to read. */
async function readFound(file: string): Promise<Record<string, unknown> | null> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function write(file: string, settings: object): Promise<void> {
  return atomicWrite(file, JSON.stringify(settings, null, 2));
}

/**
 * The settings, for the status of a server that is not running. Writes nothing.
 *
 * A stopped server is shown every time the editor asks for the status, and
 * asking must not be what creates a file, nor what rewrites one.
 */
export async function readDeviceSettings(file: string): Promise<DeviceSettings> {
  const found = await readFound(file);
  return found === null ? createDeviceSettings() : conformDeviceSettings(found);
}

/**
 * The settings a server starts on, written first when they have to be.
 *
 * The token is the one field written back on its own, because it is the one a
 * running server hands out: a token made up for this run alone would be a
 * bookmark that dies with it. Every other value that will not do is read as
 * the factory's and left in the file, so the next build that understands it
 * finds it there.
 */
export async function ensureDeviceSettings(file: string): Promise<DeviceSettings> {
  const found = await readFound(file);
  if (found === null) {
    const settings = createDeviceSettings();
    await write(file, settings);
    return settings;
  }
  if (!isUsableDeviceToken(found['token'])) {
    const repaired = { ...found, token: createDeviceToken() };
    await write(file, repaired);
    return conformDeviceSettings(repaired);
  }
  return conformDeviceSettings(found);
}

/**
 * Writes a patch over the file as found — or over the factory's settings when
 * there is none. A patch with nothing in it, as one is once conformed from
 * nonsense, writes nothing.
 */
export async function updateDeviceSettings(
  file: string,
  patch: DeviceSettingsPatch,
): Promise<DeviceSettings> {
  const found = await readFound(file);
  if (found !== null && Object.keys(patch).length === 0) return conformDeviceSettings(found);
  const updated = { ...(found ?? createDeviceSettings()), ...patch };
  await write(file, updated);
  return conformDeviceSettings(updated);
}
