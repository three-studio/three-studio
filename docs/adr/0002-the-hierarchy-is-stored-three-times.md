# The hierarchy is stored three times

**Status**: accepted. Reconstructed from the code — see `README.md` in this directory.

## Context

A scene tree can be stored once, as `parent.children[]`, and every other question answered by walking
it. That makes reparenting O(depth) and, worse for this codebase, makes an immer patch for a move
reach the whole subtree.

## Decision

The tree is stored **three times over**: `child.parent`, `parent.children[]`, and `scene.rootOrder`.
Reparenting is O(1) and the patches immer produces stay shallow.

## Consequences

Three writes have to agree, and nothing about the data enforces it. That is why every edit to the
hierarchy goes through **one module** — `core/src/scene/graph.ts` — rather than being written wherever
it is convenient. Before that module existed the only thing checking the three copies was
`repairHierarchy`, at load time, so an edit that broke an edge stayed broken for the rest of the
session and was written to disk that way.

The redundancy is the reason the single door exists. Removing either would put the other back in
question.
