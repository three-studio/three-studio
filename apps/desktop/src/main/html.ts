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

/**
 * Text made safe between tags: what `<title>` holds.
 *
 * `>` too, though only `<` and `&` can end text early: a title is shown to a
 * person, and one that looks like markup in the source is a title somebody
 * will paste somewhere it means something.
 */
function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * The page with its `<title>` saying `title`, escaped as text — added to
 * `<head>` when the page has none, `null` when it has no head either.
 *
 * What a tab shows before any script has run, and what a link preview shows,
 * which runs none at all. The player sets `document.title` once it has booted,
 * so until then every exported game was called "Studio Build".
 */
export function setTitle(html: string, title: string): string | null {
  const text = escapeText(title);
  if (/<title[^>]*>[\s\S]*?<\/title>/i.test(html)) {
    // A replacer function, for the reason `insertIntoHead` gives: a title
    // holding `$&` would otherwise be written back as something else.
    return html.replace(
      /<title([^>]*)>[\s\S]*?<\/title>/i,
      (_match, attributes: string) => `<title${attributes}>${text}</title>`,
    );
  }
  return insertIntoHead(html, `<title>${text}</title>`);
}
