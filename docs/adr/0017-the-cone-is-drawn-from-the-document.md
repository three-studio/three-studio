# A positional source's cone is drawn from the document

**Status**: accepted. Reconstructed from the code — see `README.md` in this directory.

## Context

three ships `PositionalAudioHelper`, which draws the cone of a `PositionalAudio` object. Using it would
mean the editor holding an audio graph for every source in the scene, whether or not anything is
playing, purely so a gizmo has something to read.

## Decision

The overlay is drawn from the **document**. There is no `PositionalAudio` to hand to a helper, and
there does not need to be.

## Consequences

The numbers a designer is trying to read — where full volume ends, where the sound stops carrying,
which way the cone points — are all fields of the component. So the file that draws it is short, and it
works with nothing playing.

It is the same rule the whole editor is built on, applied to a helper: the document is authoritative
and what is drawn is a view of it.
