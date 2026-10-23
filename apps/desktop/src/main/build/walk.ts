import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** One file found under a folder. */
export interface WalkedFile {
  /** Relative to the folder walked, `/`-separated, NFC: what it is compared by. */
  path: string;
  /** The same, spelled as the disk spells it, which is what a misspelling is told by. */
  raw: string;
  /** Where it is, to read or remove it. */
  absolute: string;
  /** Reported as a link and never followed: what it points at is not in the folder. */
  symlink: boolean;
}

/**
 * Every file under a folder, sorted by path.
 *
 * By hand rather than `readdir(recursive)`, for three reasons. The paths have
 * to carry `/` on every platform, since they are compared with a list written
 * on another machine. A symlinked folder must not be entered — it can lead
 * anywhere, back to itself included. And a name has to be compared as NFC while
 * the disk keeps its own spelling, which is the only way to notice the two
 * differ.
 *
 * @param top Which names at the top of the folder to enter. The build's own,
 *   never the author's `.git` beside them.
 */
export async function walkFiles(
  root: string,
  top: (name: string) => boolean = () => true,
): Promise<WalkedFile[]> {
  const found: WalkedFile[] = [];

  const visit = async (directory: string, path: string, raw: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return; // Not there: a build without assets has no `assets/`.
    }
    for (const entry of entries) {
      if (raw === '' && !top(entry.name)) continue;
      const childPath = path === '' ? entry.name.normalize('NFC') : `${path}/${entry.name.normalize('NFC')}`;
      const childRaw = raw === '' ? entry.name : `${raw}/${entry.name}`;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute, childPath, childRaw);
      else found.push({ path: childPath, raw: childRaw, absolute, symlink: entry.isSymbolicLink() });
    }
  };

  await visit(root, '', '');
  return found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
