# The expansion compares; it does not subscribe

**Status**: accepted. Reconstructed from the code — see `README.md` in this directory.

## Context

The scene as drawn is the document with its prefab instances expanded. It has to be recomputed when
either input moves, and not otherwise — it is read during render, several times a frame.

A signals library would express that. It would also be another pattern to learn, in a codebase whose
state is already zustand plus immer.

## Decision

Ten lines of comparison rather than a reactive dependency graph. **Identity is the signal**: immer
keeps the reference of anything a mutation did not touch, so `scene === from.scene` is a true "the
document did not change" rather than a guess.

## Consequences

The comparison is exact, not heuristic, and it costs two reference checks.

It also means the guarantee is immer's. A mutation path that replaced objects it did not change would
make the memo miss, quietly, and nothing would fail.
