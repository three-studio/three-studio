/*
 * One rule for a name that has to become a file.
 *
 * There were two, applied to names that land in the same tree: one for project
 * folders and scenes, one for asset folders, prefabs and materials. They took
 * the same characters out in a different order and only the first took out the
 * control codes — so a name the asset panel accepted was one the scene panel
 * would have rewritten, and the two disagreed about the same directory.
 *
 * Here rather than in the desktop app because the **editor** validates a name
 * before sending it and the **main process** rewrites it after. Two answers to
 * "may this be a file name" is how a dialog comes to accept what the disk then
 * quietly changes.
 */

/**
 * The characters a name may not carry: what Windows reserves, both separators,
 * and the control codes.
 *
 * A `/` is the one that does more than look wrong — it silently makes a folder.
 * The control codes are invisible in every UI there is, so a name carrying one
 * reads as identical to a name that does not and is a different file.
 */
const FORBIDDEN = '<>:"/\\\\|?*\\u0000-\\u001f';

/**
 * For a caller that has to say *why* rather than repair it — a dialog, which
 * should refuse before the write rather than change what was typed.
 *
 * Not global: a global regular expression carries `lastIndex` between calls,
 * so `test` on one answers `true`, then `false`, then `true` on the same input.
 */
export const FORBIDDEN_FILE_NAME_CHARS = new RegExp(`[${FORBIDDEN}]`);

/** The same class, global, for the rewrite below. Hoisted: it is per module. */
const ALL_FORBIDDEN = new RegExp(`[${FORBIDDEN}]`, 'g');

/**
 * A name reduced to what a file system will keep, and to what reads back as
 * itself.
 *
 * Trailing dots and spaces go because **Windows strips them silently**, which
 * leaves the name on disk different from the one that was asked for — and every
 * name here is read back out of its own path. Runs of whitespace collapse for
 * the same reason a person would: two spaces and three look alike and are not.
 * Spaces themselves are kept; they are legal everywhere, and quoting a path is
 * the caller's job.
 *
 * **Empty is a real answer**, and it is the caller's to interpret: a material
 * called `...` falls back to `Material`, and a scene called `...` is refused.
 * Which of the two it is has nothing to do with the character rule, so it is
 * not decided here. A forbidden character is *replaced* rather than dropped, so
 * only a name of whitespace and dots comes back empty.
 */
export function safeFileName(name: string): string {
  return name
    .replace(ALL_FORBIDDEN, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/, '')
    .trim();
}
