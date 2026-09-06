# Components live in tables, not in an array on the entity

**Status**: accepted. Reconstructed from the code — see `README.md` in this directory.

## Context

`EntityDoc.components` was an array. An array answers none of the questions actually asked of it:
"every light in the scene" was a walk of the whole entity table, a prefab override named a component
by its *position*, and touching one field changed the identity of the array — so the binder rebuilt
every non-mesh component of that entity.

## Decision

Components live in `scene.components`, keyed **by type, then by entity, then by the component's own
id**. The array is gone; its order was the only thing in it that was not derivable, and it was read
once during the migration and dropped.

Each level earns its place:

- **Type first** — `Object.keys(components.light)` is the query that motivated the change.
- **Entity second** — deleting, cloning or instancing an entity moves one key per type rather than one
  key per component.
- **Component id last** — a slot index would be a position again, and would reopen the override bug
  for any entity carrying two components of one type. See `0004`.

## Consequences

`findComponent` takes the document and an entity id rather than an `EntityDoc`, because an entity no
longer holds its components.

**Nothing that runs per frame may walk the entity table.** The overlay's marker pass and the viewport's
sync are driven by a dirty set computed structurally, and every lookup they make is against a component
table. The one thing that forced a full scan — deciding whether an entity carrying nothing should get a
marker — stopped being a question when `0007` said it gets none.
