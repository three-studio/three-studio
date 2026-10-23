/**
 * The side files a model declares, filtered down to the ones we may copy.
 *
 * Shared by the formats that reference anything: glTF names its buffers and
 * images, OBJ names a material library which in turn names its maps. What a
 * reference is *allowed* to be is the same question in both, and getting it
 * wrong is either a broken import or a copy reaching outside the source folder.
 */
export class CompanionSet {
  private readonly found = new Set<string>();

  add(reference: string | undefined): void {
    const path = reference === undefined ? null : companionPath(reference);
    if (path !== null) this.found.add(path);
  }

  toArray(): readonly string[] {
    return [...this.found];
  }
}

/** A URI scheme, which is also what a Windows drive (`C:`) looks like. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

// The C0 controls and DEL: nothing a file name on any of our platforms holds on
// purpose, and NUL truncates a path where Node hands it to the system.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * A reference as the relative path it names, or `null` when it names nothing
 * we may copy.
 *
 * **Decoded first, checked after.** The check used to read the text as written
 * and the decoding came after it, so `%2e%2e/` — two dots, spelled the way a
 * URI spells them — passed as an ordinary name and came out as `../`. Every
 * caller joins what this returns onto a folder: an import copied the file it
 * named into the project, the preview served it, a move renamed it, and an
 * export put it in a folder the author then publishes. A model downloaded from
 * anywhere decided which file.
 *
 * `..` is refused as a segment, not as two characters: `leaf..final.png` is a
 * name, where the old test refused it and let `%2e%2e` through.
 */
function companionPath(reference: string): string | null {
  const trimmed = reference.trim();
  // A scheme says the file is not beside the model: a data URI is already
  // inline, a URL is somebody else's to serve, and `C:` is an absolute path.
  if (trimmed === '' || SCHEME.test(trimmed)) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    // `100%.png` is not a URI, and guessing what it meant is how two readers
    // end up disagreeing about one file. Skipped on its own: a glTF used to
    // lose every reference after it, and an OBJ failed whatever had asked.
    return null;
  }

  // Exporters on Windows write `textures\bark.png`, and nothing on the web
  // reads a backslash as anything but a separator either.
  const slashed = decoded.replace(/\\/g, '/');
  if (slashed.startsWith('/') || SCHEME.test(slashed) || CONTROL.test(slashed)) return null;

  const segments: string[] = [];
  for (const segment of slashed.split('/')) {
    // `./tree.bin` is how a good many exporters name a sibling.
    if (segment === '' || segment === '.') continue;
    if (segment === '..') return null;
    segments.push(segment);
  }
  return segments.length === 0 ? null : segments.join('/');
}

/** The directory part of a relative posix path; `''` when there is none. */
export function relativeDirname(path: string): string {
  const slash = path.replace(/\\/g, '/').lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/** Joins a relative posix directory and a name, either of which may be empty. */
export function relativeJoin(directory: string, name: string): string {
  if (directory === '') return name;
  return `${directory.replace(/\/+$/, '')}/${name}`;
}
