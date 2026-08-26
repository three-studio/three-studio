/*
 * A value computed from **declared** inputs, recomputed when one of them moves.
 *
 * A primitive, not a graph, and the reason is that the inventory `CIBLE.md`
 * built has largely been paid off since. Of the six ways of saying "this
 * changed": the drained `Set` and the module-level callback slots — the two that
 * structurally forbade a second consumer — went in phase 6, and object identity
 * preserved by immer *is* the mechanism rather than a shortcoming. What is left
 * is memoisation that works, and a signals library for that would be exactly the
 * "more patterns" ADR-8 refuses.
 *
 * What memoisation by hand cannot do is say **what it is memoised on**.
 * `expandedScene()` was a module-level `let` read during React render, so its
 * inputs lived nowhere: a consumer that wanted to know when it changed had to
 * work that out for itself. Here they are written beside the computation, once.
 *
 * **This does not replace the dependency arrays of the consumers**, and it must
 * not. `HierarchyPanel` memoises its rows on `structureRevision`, which is
 * deliberately *narrower* than this derivation's inputs: the scene changes on
 * every frame of a gizmo drag, and the whole point of phase 7 was that the
 * hierarchy does not rebuild four thousand rows when only a transform moved —
 * 422ms per nudge, of which 404ms was that walk. A component subscribing to
 * "the expansion changed" would put every one of those milliseconds back.
 * Narrower is not a mirror gone wrong; it is a filter this cannot express.
 */

export interface Derived<T> {
  /** The current value, recomputed only when an input moved. */
  get(): T;
}

/**
 * @param compute What the value is. Handed the previous one, for the
 *   computations that reuse it — prefab expansion above all, which gives back
 *   the entities an untouched instance produced last time.
 * @param inputs What it is computed from. **Compared by identity**, which immer
 *   makes exact: anything a mutation did not touch keeps its reference.
 */
export function derived<T>(
  compute: (previous: T | undefined) => T,
  inputs: () => readonly unknown[],
): Derived<T> {
  let value: T | undefined;
  let last: readonly unknown[] | null = null;

  return {
    get: () => {
      const next = inputs();
      if (
        last !== null &&
        last.length === next.length &&
        last.every((input, index) => input === next[index])
      ) {
        return value as T;
      }
      last = next;
      value = compute(value);
      return value;
    },
  };
}
