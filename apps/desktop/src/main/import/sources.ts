import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { importerForFile } from '@three-studio/core';

/**
 * How deep a dropped folder is followed, and how many files come out of it.
 *
 * Neither is a real limit on anyone's project; both are there so that dropping
 * a home directory by accident produces a dialog rather than a hang.
 */
const MAX_DEPTH = 12;
const MAX_FILES = 2000;

export interface ExpandedSources {
  paths: readonly string[];
  /** True when a limit stopped the walk, so the dialog can say so. */
  truncated: boolean;
}

/**
 * Turns what was dropped into a list of files to stage.
 *
 * A folder is walked; a file named outright is taken as it is. The difference
 * matters at the edges: naming `notes.txt` deserves a row saying nothing can
 * import it, while a folder holding two models and forty other files means
 * "bring in the models" — listing its `.DS_Store` as a failure would be an
 * answer to a question nobody asked.
 */
export async function expandSources(paths: readonly string[]): Promise<ExpandedSources> {
  const found: string[] = [];
  let truncated = false;

  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) {
      truncated = true;
      return;
    }
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      // Unreadable folder: not worth failing the whole drop over.
      return;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (found.length >= MAX_FILES) {
        truncated = true;
        return;
      }
      const child = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(child, depth + 1);
        continue;
      }
      if (importerForFile(entry.name)) found.push(child);
    }
  };

  for (const path of paths) {
    if (found.length >= MAX_FILES) {
      truncated = true;
      break;
    }
    let info;
    try {
      info = await stat(path);
    } catch {
      continue;
    }
    if (info.isDirectory()) await walk(path, 0);
    else found.push(path);
  }

  return { paths: found, truncated };
}
