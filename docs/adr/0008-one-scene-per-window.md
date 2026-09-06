# One scene per window, and switching reloads

**Status**: accepted. Reconstructed from the code — see `README.md` in this directory.

## Context

An editor could show several scenes as tabs inside one window. This project shows one scene per window
and opens a second window for a second scene.

The alternative to a reload — swapping the document inside the running renderer — exists in the code
as `replaceScene`, used by prefab mode and by leaving Play. It carries two open defects: the unsaved
flag is overwritten, and the undo history is destroyed.

## Decision

A window holds **one** scene. Opening another scene in this window **reloads** it, through the main
process, with the unsaved-changes prompt on the way. Opening a scene that is already open focuses the
window that has it.

The cost is about a second of empty window, and it is accepted: a reload gives a fresh document, a
fresh history and a teardown nobody can forget to write.

## Consequences

**The scene travels in the URL; the role and the project travel in argv.** `webContents.reload()`
replays `additionalArguments` verbatim, so argv can only carry what is fixed for the life of a window.
The role and the project are fixed. The scene is exactly the thing that changes — and a query string
survives a reload *and* can be replaced without one.

Two operations that look alike and are not:

- **Retarget** — same document, new file (Save As, and a rename). No reload: nothing on screen has
  changed, and reloading would throw the undo history away. The URL is rewritten in place.
- **Switch** — a different document (open another scene, delete this one). A reload.

An Inspector target for the scene needs no id, because there is only ever one of it in a window.

Closing the last editor window brings the launcher back; closing the launcher quits.
