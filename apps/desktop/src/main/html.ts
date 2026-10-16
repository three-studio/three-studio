/*
 * A tag put first in a page's `<head>`: an export's `<base>`, and the device
 * client in every page the device server serves. First, because a `<base>`
 * governs only the URLs after it, and a classic script there runs before
 * anything the page goes on to load.
 */

/** The page with `tag` first in its `<head>`, or `null` when it has none. */
export function insertIntoHead(html: string, tag: string): string | null {
  if (!/<head[^>]*>/i.test(html)) return null;
  // A replacer function, not a replacement string: `String.replace` reads `$&`,
  // "$`", `$1` and friends out of a string, so a tag carrying `$1` would be
  // written back with a captured group in place of itself.
  return html.replace(
    /<head([^>]*)>/i,
    (_match, attributes: string) => `<head${attributes}>\n    ${tag}`,
  );
}

/**
 * A value made safe inside a double-quoted attribute.
 *
 * Second net behind whatever checked the value before it got here — an
 * export's `basePathProblem`, a launch id made by the server. Kept because the
 * value lands in markup either way, and a validator and an emitter that trust
 * each other are how injections happen.
 */
export function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}
