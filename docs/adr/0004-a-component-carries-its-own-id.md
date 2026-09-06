# A component carries its own id

**Status**: accepted. Reconstructed from the code — see `README.md` in this directory.

## Context

A prefab override named the component it changed by its **position** in the entity's component array.
Removing a component ahead of it slid every later one onto a new index, so an override that had been
recorded against the second collider silently applied to the first.

## Decision

Every component carries an `id`, and an override names it by that id.

A document written before ids existed gets them derived from where its components already are, so a
scene and the prefabs it places agree without either being able to read the other's migration.

## Consequences

This is what makes the third level of the component tables an id rather than a slot — see `0003`.
Keying by position would be the same defect in a narrower costume: with two colliders on one entity,
deleting the first slides the second onto its index.

The scene and prefab format versions move together where this is concerned, because the two are
migrated by the same function.
