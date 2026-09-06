# The undo stack has invariants, and they are checked by a property

**Status**: accepted. Reconstructed from the code — see `README.md` in this directory.

⚠️ **Incomplete on purpose.** The code cites "ADR-4's nine invariants" and names three of them by
number. The other six are not recoverable from the citations, and inventing them would be worse than
leaving the gap visible. What follows is what the code actually says.

## Context

Undo is the feature where a mistake is subtle: nothing throws, and the document drifts from what the
author believes it is. It cannot be checked by looking at it.

## Decision

Every mutation of the document goes through **one** entry point, and a history entry carries everything
needed to take a whole user action back — not just the patches.

The invariants named in the code:

- **1 — one door, carrying everything.** `mutate` takes the label, the recipe and its options
  together. It used to take a bare `coalesceKey` and drop `external` on the floor: two ways in, one of
  which lost information.
- **2 — the selection is not optional.** `selectionBefore` and `selectionAfter` are required fields on
  an entry. An optional field is a field somebody forgets, which is how undo used to leave the gizmo
  pointing at an entity it had just deleted.
- **6 — coalescing is where a mistake breaks undo subtly.** A ten-second drag at 60 fps leaves about
  six hundred patch/inverse pairs in one entry, all of them overwriting the same path, none of which
  will ever be reduced. They are collapsed to one.

## Consequences

**The measure that pays for itself most is the round trip**: for any sequence of commands, N undos
return the editor to where it started, and N redos to where it ended. It is a property test, and it is
the real check — the example tests beside it pin the shape.

An edit that does not live in the document rides in the same entry and is replayed by calling back out
(`ExternalEdit`), rather than living in a second stack that would interleave wrongly with the first.
Editing a material asset is the case: it changes a file, not the scene, and Cmd+Z still has to take it
back.

The stack and `savedRevision` travel as one value, because `savedRevision` means nothing without the
`revision` it is compared to.

The same argument — a guard that is optional is a guard somebody forgets — is why `Command.can` is
required rather than optional; see the command registry.
