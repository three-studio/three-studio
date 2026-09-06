# The root `Scene` entity is ordinary

**Status**: accepted. Reconstructed from the code — see `README.md` in this directory.

## Context

Every new scene opens with an entity called `Scene`. It is where scripts belonging to the level rather
than to a thing in it are attached — Unity puts them on a GameObject and Godot on the root node, and
both do it because the alternative, letting the scene itself carry scripts, makes `this.entity` and
`this.transform` null for those alone.

## Decision

It is an ordinary entity: **ni protégée, ni spéciale**. A convention, not a feature, and nothing in the
code names it.

## Consequences

Any rule about entities has to hold for it too, which is a constraint rather than a freedom — and a
useful one.

The case that showed why: an entity carrying no components used to get a grey viewport marker, and on
this node a marker says "an entity is at the origin", which the hierarchy already says better. Naming
the node as an exception was ruled out here, so the rule had to change for *every* bare entity — and it
did. A bare entity earns no marker, because a group is scaffolding and what hangs under it is what an
author clicks.

That change is also what let the marker pass stop walking the entity table; see `0003`.
