# The audio context is a parameter, never a `new` buried in a constructor

**Status**: accepted. Reconstructed from the code — see `README.md` in this directory.

## Context

**vitest runs in `environment: 'node'`**, where the Web Audio *types* exist in `lib.dom` and the
*values* do not. `new AudioContext()` inside a constructor makes the whole module unloadable in a test,
and everything worth checking — the mix, the solo, the crossfade, the voice stealing — becomes
unobservable.

## Decision

The context arrives as a parameter, typed **structurally** (`AudioContextLike`) rather than imported
from `lib.dom`. Everything else the audio layer needs from the window it runs in comes the same way:
the resolver, the loader, `requestAnimationFrame`.

## Consequences

A fake that satisfies those interfaces is a hundred lines and makes the mix, the crossfade and the
voice stealing testable as arithmetic. The real `AudioContext` satisfies them too — every member
declared is a subset of the real shape.

The same rule put the component systems on the *view* side rather than in the hierarchy: the document
is authoritative and three.js is a derived view, so a hierarchy of objects wrapping `Object3D` cannot
be the thing that is tested.

`Picker` is the non-audio instance of the same decision; see `0011`.
