import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectSummary } from '@three-studio/core';
import { app } from 'electron';

const FILE_NAME = 'recent-projects.json';
const MAX_ENTRIES = 20;

/**
 * Bumped when the shape of an entry changes.
 *
 * The file used to be a bare array, with nothing saying what an entry looked
 * like — a changed field would have been read as if it had always been there.
 * The array form is still accepted, since every existing install has one.
 */
const RECENTS_VERSION = 1;

interface RecentsFile {
  version: number;
  projects: ProjectSummary[];
}

function storePath(): string {
  return join(app.getPath('userData'), FILE_NAME);
}

export async function listRecent(): Promise<ProjectSummary[]> {
  try {
    const raw = await readFile(storePath(), 'utf8');
    const parsed: unknown = JSON.parse(raw);

    // The unversioned array is what every install written before this had.
    const entries = Array.isArray(parsed)
      ? (parsed as ProjectSummary[])
      : isRecentsFile(parsed) && parsed.version <= RECENTS_VERSION
        ? parsed.projects
        : [];

    return entries
      // A newer editor may have written entries this build cannot read; drop
      // those rather than show a launcher row that opens nothing.
      .filter((entry) => typeof entry?.path === 'string' && typeof entry.name === 'string')
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  } catch {
    // Missing or corrupt recents must never stop the app from starting.
    return [];
  }
}

export async function remember(summary: ProjectSummary): Promise<void> {
  // A check must not write into the user's app data. The headless harness opens
  // throwaway copies of projects, and every one of them used to land in the
  // launcher's recents — where they stay long after the folder is gone.
  if (process.env['STUDIO_SMOKE']) return;

  const existing = await listRecent();
  const next = [summary, ...existing.filter((entry) => entry.path !== summary.path)].slice(
    0,
    MAX_ENTRIES,
  );
  await writeStore(next);
}

export async function forget(projectPath: string): Promise<void> {
  const existing = await listRecent();
  await writeStore(existing.filter((entry) => entry.path !== projectPath));
}

function isRecentsFile(value: unknown): value is RecentsFile {
  if (typeof value !== 'object' || value === null) return false;
  const file = value as Partial<RecentsFile>;
  return typeof file.version === 'number' && Array.isArray(file.projects);
}

async function writeStore(entries: ProjectSummary[]): Promise<void> {
  const file: RecentsFile = { version: RECENTS_VERSION, projects: entries };
  try {
    await writeFile(storePath(), JSON.stringify(file, null, 2), 'utf8');
  } catch {
    // A read-only or full userData directory degrades the recents list, which
    // is a convenience, not a correctness concern.
  }
}
