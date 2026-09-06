# The listener is the component, and the active camera when there is none

**Status**: accepted. Reconstructed from the code — see `README.md` in this directory.

## Context

Positional audio needs an ear. A scene may name one with an `audioListener` component, or name none,
or name several.

## Decision

- **One component**: it is the ear, and its behaviour writes the listener pose each frame. That is what
  lets the ear sit on the player while the camera orbits behind it — the case that makes the component
  worth having at all.
- **None**: the engine puts the ear on whatever camera the game is rendered through. Right far more
  often than it is wrong, and very much better than a silent scene.
- **Several**: the first behaviour to write each frame wins, and the engine **warns**. Two ears is a
  bug that sounds like a mixing problem, so saying so is the whole value of the warning.

## Consequences

The engine counts the ears, and the count is also what decides the fallback.

A scene with no ear that plays nothing would be the worst possible first contact with the system, which
is the reason the fallback exists at all rather than a warning alone.
