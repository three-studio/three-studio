# A scene's name is its file name

**Status**: accepted. Reconstructed from the code — see `README.md` in this directory.

## Context

A scene had a `name` inside its document *and* a file on disk, and the two could disagree. The file
stayed put and the label moved, so the Finder and the editor told different stories about what a scene
was called.

## Decision

`scenes/Level2.scene.json` is the scene called `Level2`. The name is derived from the path, and
renaming a scene **moves the file**.

## Consequences

The Inspector's Name field for a scene reads and writes the scene's *address*, not `SceneDoc.name` —
one field in the whole schema that does not go through the document.

The document keeps a copy of the name anyway, because a build falls back to it for the window title,
and because a scene read on its own should be able to say what it is called.

Renaming is safe precisely because of `0005`: no reference moves with the file. But the path is not a
reference — it is where the window saves — so a window showing a renamed scene has to retarget onto
the file that just moved, or its next save writes the scene back under its old name and the project
has two.
