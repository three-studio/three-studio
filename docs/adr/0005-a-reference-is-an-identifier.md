# A reference is an identifier, never a name and never a path

**Status**: accepted. Reconstructed from the code — see `README.md` in this directory.

## Context

Scenes were addressed by path and, in places, by name. Both break under the one operation an author
performs constantly: renaming. A path also breaks under a move made outside the editor.

## Decision

Everything that refers to a scene refers to `SceneDoc.id`, written into the document when the scene is
created. That covers `startScene`, `loadingScene`, every build profile, the scene an editor window is
open on, and the scenes an export ships.

## Consequences

**Renaming a scene moves its file and rewrites nothing else.** That is what makes a rename cost one
write and break nothing — see `0006`, where the file name *is* the name.

An open window survives a rename, because the window carries the id rather than the path.

A build files every scene under its own id, so the path in the manifest is `buildScenePath` of the id
rather than something to look up. The names travel beside them as an alias table, for a script that
says `load('Level2')`.

The indicative half of a scene's identity — its name — is what a script comparing `scenes.current`
reads; the stable half is the id, and a script that wants stability names that instead.
