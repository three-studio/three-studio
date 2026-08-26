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
    if (reference === undefined) return;
    const trimmed = reference.trim();
    // A data URI is already inline, and an absolute one is not ours to copy.
    if (trimmed === '' || trimmed.startsWith('data:') || /^[a-z]+:\/\//i.test(trimmed)) return;
    if (trimmed.startsWith('/') || trimmed.includes('..')) return;
    this.found.add(decodeURIComponent(trimmed));
  }

  toArray(): readonly string[] {
    return [...this.found];
  }
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
