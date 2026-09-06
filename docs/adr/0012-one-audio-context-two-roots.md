# One audio context, one gain root per engine

**Status**: accepted. Reconstructed from the code — see `README.md` in this directory.

## Context

Two things in the editor make sound: the running game, and the audition the Project panel and the
Inspector offer while nothing is running. The obvious arrangement is an `AudioContext` each.

It does not work. A browser caps how many contexts a page may have — Chrome around six — and, far
worse, **each one has to be started by its own user gesture**. Two contexts means two chances for a
page to be silent for a reason nobody can see.

## Decision

**One context** for the whole editor, and **two `AudioEngine`s on it**, kept apart by a root gain each.
The game's engine is built by `Engine`; the editor builds its own for preview. Neither can hear the
other.

The context is passed into `Engine` rather than created by it, for the same reason — and omitting it is
a game with no audio, which is what a test wants.

## Consequences

Stopping the game does not stop an audition, and an audition does not turn up in the game's mix. That
separation is the whole requirement.

The audition has **its own level**, not the project's: turning previews down while working cannot
follow the project into play mode or into a build.

The root, not the master bus, is the output node — see `0014`. It is what `masterVolume` and the mute
act on, and what a second mixer on the same context uses to stay independent of the first.
