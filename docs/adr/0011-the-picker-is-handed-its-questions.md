# The picker is handed its questions

**Status**: accepted. Reconstructed from the code — see `README.md` in this directory.

## Context

Deciding what a click lands on needs to know which entities are pickable and which editor-only markers
stand in for entities that draw nothing. Both answers live in stores.

## Decision

They are **parameters**. `Picker` takes a `pickable` predicate and the overlay root as a bare
`Object3D`, and knows nothing about the document or about any store.

## Consequences

The class is testable without an editor around it, and it cannot acquire an opinion about the document
by accident.

This is the same shape as the audio decision that makes the context a parameter — see `0013` — and for
a related reason: a module that reaches for its dependencies cannot be exercised anywhere but in the
app.
