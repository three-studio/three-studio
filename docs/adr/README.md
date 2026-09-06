# Architecture decisions

One file per decision, numbered, never renumbered again.

## How these were written

The code cited `ADR-1` through `ADR-16` sixty-eight times and **no such documents existed**. The
reasoning had not been lost — it is in the comments, often in more detail than an ADR would carry — but
it had stopped being addressable: a reader who met `(ADR-15)` in a signature had nowhere to go.

Two numbers were each doing duty for two unrelated decisions, which is worse than none: one meant both
the single audio context and the undo invariants, another both component identity and the audio
listener. Nothing but the surrounding paragraph could tell you which.

So these are **reconstructed from the citations themselves**, and renumbered into one series with no
collisions. What is here is what the code says. Where the citations do not say enough — the undo
invariants are named "nine" and only three are named individually — the gap is marked in the document
rather than filled in.

`0001` predates the reconstruction and was written as an ordinary ADR; it is longer than the rest for
that reason.

## The rule

`test/adr.test.ts` checks that every citation resolves to a document and that every document is cited
by the code it is about. A decision that drifts out of the codebase, or a citation of a number nobody
wrote down, fails the build.

Citations are four digits — `ADR-0005` — so that a grep and an `ls` of this directory agree.

## The decisions

| | |
|---|---|
| [0001](0001-compression-enters-through-the-importers.md) | Texture and mesh compression enters through the importers |
| [0002](0002-the-hierarchy-is-stored-three-times.md) | The hierarchy is stored three times |
| [0003](0003-components-live-in-tables-not-in-the-entity.md) | Components live in tables, not in an array on the entity |
| [0004](0004-a-component-carries-its-own-id.md) | A component carries its own id |
| [0005](0005-a-reference-is-an-identifier.md) | A reference is an identifier, never a name and never a path |
| [0006](0006-a-scenes-name-is-its-file-name.md) | A scene's name is its file name |
| [0007](0007-the-root-entity-is-an-ordinary-entity.md) | The root `Scene` entity is ordinary |
| [0008](0008-one-scene-per-window.md) | One scene per window, and switching reloads |
| [0009](0009-the-undo-invariants.md) | The undo stack has invariants, checked by a property |
| [0010](0010-the-expansion-compares-it-does-not-subscribe.md) | The expansion compares; it does not subscribe |
| [0011](0011-the-picker-is-handed-its-questions.md) | The picker is handed its questions |
| [0012](0012-one-audio-context-two-roots.md) | One audio context, one gain root per engine |
| [0013](0013-the-audio-context-is-a-parameter.md) | The audio context is a parameter |
| [0014](0014-the-mixer-is-flat.md) | The mixer is flat |
| [0015](0015-the-listener-is-the-component-then-the-camera.md) | The listener is the component, then the active camera |
| [0016](0016-a-clips-facts-are-read-by-the-renderer.md) | A clip's facts are read by the renderer |
| [0017](0017-the-cone-is-drawn-from-the-document.md) | A positional source's cone is drawn from the document |
