/**
 * `JSON.stringify` with every object's keys in a fixed order, indented for a
 * diff.
 *
 * A JSON object's keys come out in the order they were inserted, and for a
 * document an editor built that is **the order the author did things in**. Two
 * people who built the same scene by different routes wrote two different
 * files, and moving one entity could rewrite lines that had nothing to do with
 * it. Losing that is the condition a project has to meet before it can live in
 * git at all — nothing downstream in this format is worth much until a diff is
 * something a person can read.
 *
 * **Arrays are handed back untouched, and that is the whole of the care this
 * needs.** In these documents an array's order *is* the meaning: `rootOrder` is
 * the hierarchy, `children` is the hierarchy, and a `Vec3` is three numbers
 * whose positions are x, y and z. `null` is typed `object` in JavaScript, so
 * the same guard lets it through.
 *
 * Plain `.sort()`, deliberately. It compares UTF-16 code units, which is the
 * same answer on every machine; `localeCompare` reads the host's locale, so it
 * would order the keys differently on a Turkish laptop and put back exactly the
 * per-machine diff this exists to remove.
 *
 * One thing it does not do, because it cannot and need not: a key that looks
 * like an array index — `"2"` — is placed by the engine ahead of every other
 * key, in ascending numeric order, whatever order it was written in. That is
 * already the same everywhere. It is written down only because it surprises
 * whoever writes a test with numeric keys and finds them somewhere else.
 *
 * `runtime`'s `stableKey` reached the same conclusion from the other end —
 * sorting so that a geometry has one identity rather than one per build of the
 * editor. The two are not shared: that one is a cache key, one level deep and
 * never indented.
 */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, sortKeys, 2);
}

function sortKeys(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;

  // A fresh object, because insertion is the only way to set key order.
  // `JSON.stringify` calls the replacer again for each of these values, so one
  // pass covers the whole tree.
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = (value as Record<string, unknown>)[key];
  }
  return sorted;
}
