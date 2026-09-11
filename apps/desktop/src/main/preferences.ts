import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  LAYOUT_PREFERENCES_VERSION,
  SHORTCUT_PREFERENCES_VERSION,
  emptyLayoutPreferences,
  emptyShortcutPreferences,
  type LayoutPreferences,
  type ShortcutPreferences,
} from '@three-studio/core';
import { app } from 'electron';
import { atomicWrite } from './atomicWrite';

const FILE_NAME = 'layouts.json';
const SHORTCUTS_FILE_NAME = 'shortcuts.json';

function layoutsPath(): string {
  return join(app.getPath('userData'), FILE_NAME);
}

function shortcutsPath(): string {
  return join(app.getPath('userData'), SHORTCUTS_FILE_NAME);
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
 * Written whole or not at all.
 *
 * The working layout is saved on every rearrangement, so a crash mid-write is
 * a real possibility; a half-written file would lose every saved template at
 * once.
 */
export async function saveLayoutPreferences(preferences: LayoutPreferences): Promise<void> {
  try {
    await atomicWrite(layoutsPath(), JSON.stringify(preferences, null, 2));
  } catch (cause) {
    // Swallowed here rather than in `atomicWrite`: a preferences directory that
    // cannot be written is a layout that will not come back next launch, which
    // is not worth failing the rearrangement the author just made.
    console.error('[preferences] could not save layouts:', cause);
  }
}

/**
 * The author's remapped keys, in their own file beside the layouts.
 *
 * A second file rather than a second key in `layouts.json`, because the two are
 * written on completely different rhythms: the working layout is saved on every
 * drag of a sash, and a shortcut is changed once a year. Sharing a file would
 * mean rewriting the bindings hundreds of times a session for nothing, and
 * losing them to a crash during one of those writes.
 *
 * Missing is the normal case: nobody has remapped anything until they have.
 */
export async function loadShortcutPreferences(): Promise<ShortcutPreferences> {
  try {
    const raw = await readFile(shortcutsPath(), 'utf8');
    const parsed = JSON.parse(raw) as ShortcutPreferences;
    if (parsed.version !== SHORTCUT_PREFERENCES_VERSION) return emptyShortcutPreferences();
    return parsed;
  } catch {
    return emptyShortcutPreferences();
  }
}

export async function saveShortcutPreferences(preferences: ShortcutPreferences): Promise<void> {
  try {
    await atomicWrite(shortcutsPath(), JSON.stringify(preferences, null, 2));
  } catch (cause) {
    console.error('[preferences] could not save shortcuts:', cause);
  }
}
