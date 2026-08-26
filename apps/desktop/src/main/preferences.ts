import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  LAYOUT_PREFERENCES_VERSION,
  emptyLayoutPreferences,
  type LayoutPreferences,
} from '@three-studio/core';
import { app } from 'electron';

const FILE_NAME = 'layouts.json';

function layoutsPath(): string {
  return join(app.getPath('userData'), FILE_NAME);
}

export async function loadLayoutPreferences(): Promise<LayoutPreferences> {
  try {
    const raw = await readFile(layoutsPath(), 'utf8');
    const parsed = JSON.parse(raw) as LayoutPreferences;
    // A file written by a newer build may describe panels this one lacks;
    // starting fresh beats restoring an arrangement that cannot be applied.
    if (parsed.version !== LAYOUT_PREFERENCES_VERSION) return emptyLayoutPreferences();
    if (!Array.isArray(parsed.templates)) return emptyLayoutPreferences();
    return parsed;
  } catch {
    // Missing on first run, and unreadable is not worth failing over.
    return emptyLayoutPreferences();
  }
}

/**
 * Written through a temporary file and a rename.
 *
 * The working layout is saved on every rearrangement, so a crash mid-write is
 * a real possibility; a half-written file would lose every saved template at
 * once.
 */
export async function saveLayoutPreferences(preferences: LayoutPreferences): Promise<void> {
  const target = layoutsPath();
  const temporary = `${target}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(preferences, null, 2), 'utf8');
    await rename(temporary, target);
  } catch (cause) {
    console.error('[preferences] could not save layouts:', cause);
  }
}
