import { isRecord } from './conform';

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
  if (!isRecord(value)) return value;

  // A Map is the object it stands for: a document keeps its containers in
  // Maps, and `JSON.stringify` writes a Map as `{}`.
  const record = value instanceof Map ? Object.fromEntries(value) : value;
  // A fresh object, because insertion is the only way to set key order.
  // `JSON.stringify` calls the replacer again for each of these values, so one
  // pass covers the whole tree.
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = record[key];
  }
  return sorted;
}

/**
 * `JSON.stringify` that writes a Map as the object it stands for, in the order
 * the Map holds its entries.
 *
 * For what is only going to be parsed again: a message over the bridge or to a
 * device, a build's manifest. It does not sort, which is what `stableJson` does
 * for a file a person reads, and what costs it most of its time: sorting
 * allocates a copy of every object in the tree. The manifest's bytes are what
 * `JSON.stringify` always wrote, and stay so.
 */
export function jsonOf(value: unknown, indent?: number): string {
  return JSON.stringify(value, mapsAsObjects, indent);
}

function mapsAsObjects(_key: string, value: unknown): unknown {
  return value instanceof Map ? Object.fromEntries(value) : value;
}

/**
 * Freezes a value and every object and array under it, and hands it back.
 *
 * For a value handed to code that is not typechecked against it — a script
 * reading a component — where `readonly` in a type says nothing: a write into
 * what the document holds would change the scene behind the frame's pass, which
 * would never hear of it. A frozen write throws, in a module's strict mode.
 *
 * A value already frozen is taken to be frozen all through and is not walked
 * again, as immer's are: what this froze once costs one check after.
 */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const inner of Array.isArray(value) ? value : Object.values(value)) deepFreeze(inner);
  return value;
}
