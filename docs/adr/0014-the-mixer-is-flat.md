# The mixer is flat

**Status**: accepted. Reconstructed from the code — see `README.md` in this directory.

## Context

Mixers are usually trees: buses feeding buses, effects at each node. A graph the author builds is the
general answer.

## Decision

**One gain node per bus, all of them under a root, and the root under the destination.** `AudioBus` is
a fixed enum, and a graph the author has to build buys nothing until there are effects to route
through.

`'master'` is a bus like the others — the default for a source with no opinion — and **not** the output
node. The output node is `root`.

## Consequences

The final volume of a sound is a **product**: its own volume, the asset's, its bus, and the root.

Keeping `root` distinct from the `master` bus is what lets a second mixer share the context and stay
independent of the first — see `0012`.
