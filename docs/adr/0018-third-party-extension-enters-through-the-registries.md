# Third-party extension enters through the registries

**Status**: accepted. As with `0001`, what is decided here is *where* extension would enter, not that
it is built — **no plugin system exists, and this document is a reason not to write one yet.**

## Context

Everything is compiled into the binary: the component types, the runtime systems, the Inspector panes,
the importers, the commands. A company adopting the editor cannot add a component type of its own, an
importer for its internal format, or a panel. For the goal of being usable in production by somebody
else, that is the heaviest thing missing.

It is also the classic trap. A plugin API written now would have **no second implementer** — nobody is
waiting to write one — and an extension point with one implementer is the shape this codebase has
decided, repeatedly, not to build. It would be designed against imagined needs, frozen the day it
shipped, and paid for for ever.

What is worth settling is where it would enter, because the work of the last year has already put the
seam in place without meaning to.

## Decision

Extension enters through the **registries that already exist**, by loading the same files a first-party
feature is made of. Nothing new is designed for it.

### The seam, named

A component type is **three folders that register themselves**:

| | |
|---|---|
| `packages/core/src/components/<type>/` | schema, defaults, and `defineComponent` |
| `packages/runtime/src/components/<type>/` | the `ComponentSystem` that draws it |
| `packages/editor/src/components/<type>/` | the Inspector schema, the Add-menu entry, the overlay |

Nine files, measured — that is the whole of a type. The other registries have the same shape:
`AssetImporter` for a format, `registerBehaviour` for runtime behaviour, `registerScript` for a
compiled script, and since the command layer landed, a family of commands is a module spread into one
table.

The Inspector is the part that makes this cheap rather than merely possible. A component describes its
fields declaratively, in the **same field vocabulary a script's properties use** — so a third-party
type gets an editing UI without writing any UI.

### What still has to be paid, and it is measured

Adding a type costs **nine new files and ten shared ones, 29 lines**. Five of those ten are the
mechanism working: `tsc` refuses to compile without the line, so nothing can be forgotten in silence.
**Five are a leak** — a missing line there is never a type error, only a throw at load or a feature
quietly absent:

- `COMPONENT_TYPES`, and the two lists of registering imports. Three statements of one fact.
- `core/src/index.ts`, the package's front door, which an editor slice needs in order to reach its own
  factory.
- `ComponentIcon`, a closed union in `core` resolved by a table in the hierarchy panel.

For a first-party type those five are a chore. **For a third-party one they are the blocker**: a plugin
cannot add a line to `COMPONENT_TYPES` in a compiled `core`. Whatever loading looks like, those three
lists have to become derivable — from the registry itself rather than beside it.

## What loading would need — and most of it is already built

The interesting fact is that **the editor already loads third-party code and runs it**: game scripts.
That path is complete, and it is the prototype for this one.

- **Compilation.** `esbuild` is a runtime dependency, not a build-time one — the packaged app compiles
  the author's scripts itself. Play compiles every time, which is what makes "edit, press Play" the
  loop.
- **Registration.** The compiled bundle calls `registerScript(assetId, class)` at import time. The
  runtime never learns how scripts were built.
- **No second copy of the runtime.** The bundle cannot import the real runtime — it would pull a
  duplicate — so the API is *handed* to a script rather than imported by it. A plugin has the same
  constraint for the same reason, and the same answer.
- **API versioning.** `SCRIPT_API_VERSION` is baked into the compiled bundle and compared against the
  running one, with a message naming both numbers. **This is the hard part of a plugin system, and it
  already exists**, for scripts.
- **Typings.** The editor writes a `.d.ts` for the API into the project, checked by a test that
  compiles what it produces.

So the three things a plugin system is usually said to need — loading, versioning, a typed API — are
demonstrated once, in production, against the narrowest possible surface.

### What is genuinely absent

**Isolation.** Windows run `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, which
protects the preload boundary from the page. It does not isolate code *inside* the page from the rest
of the page. A script is trusted today because the author wrote it; a plugin from a third party is a
different trust question, and nothing in the codebase answers it.

**A stable surface for the editor.** A script is handed a small, deliberate API. A plugin adding a
component type would touch `defineComponent`, `ComponentSystem`, the field vocabulary and the command
registry — none of which is versioned, and all of which have changed shape this year.

**The three lists.** See above. They are the concrete work item, and they are worth doing on their own
merits, whether or not a plugin ever arrives.

## What would trigger building it

One outside team that has asked, with a format or a component type they can name. Not a survey and not
a roadmap: an implementer, so that the first version of the API is shaped by a second use rather than
by a guess.

Until then, the honest position is the one the seam already takes: **a plugin is these same files,
loaded differently.** Making the three lists derivable moves that from nearly true to true, and costs
nothing to anyone who never writes a plugin.

## Why not a plugin API now

The same reason `0001` gives for compression, and one more.

An extension point with no implementer is designed against imagined needs and cannot be corrected
later without breaking the people who used it. The scripting API is the counter-example that proves
the rule: it is small, it was shaped by the game scripts actually written against it, and it is on its
second version — a number that only means anything because something was compiled against the first.

And there is a cost to writing it that is easy to miss: a published extension surface freezes the
internals it exposes. The vertical slice, the command registry and the field vocabulary all changed
shape during this refactor. Any of those changes would have been a breaking release.
