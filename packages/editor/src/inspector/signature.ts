/**
 * Which rows a pane would show, as a string of bits.
 *
 * The structure of a pane depends on exactly one thing: which of its declared
 * entries are visible. So the signature that decides "rebuild or refresh" is
 * that set, read off the same declaration the builder reads — rather than a
 * hand-written summary of what someone believed the declaration said. The two
 * had already drifted twice.
 *
 * An entry with no `visibleWhen` is always shown, so it always contributes `1`.
 * That looks wasteful and is the point: a constant bit holds the *position* of
 * every other bit, so two different rows becoming visible can never produce the
 * same string.
 *
 * **Bits rather than a list of the visible paths**, because this runs on the
 * hot path. `InspectorPanel` recomputes it on every bump of `componentRevision`
 * — which is once per frame while a slider is being dragged — and with forty
 * entities selected that is ~1600 predicates and one string. Each predicate is
 * an `===` or an `includes` over at most four strings, so the work is tens of
 * microseconds; joining paths instead would allocate tens of kilobytes a frame
 * to say the same thing.
 */
export function shapeOf<S>(
  entries: readonly { visibleWhen?: (subject: S) => boolean }[],
  subject: S,
): string {
  let shape = '';
  for (const entry of entries) shape += entry.visibleWhen?.(subject) === false ? '0' : '1';
  return shape;
}
