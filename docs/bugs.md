# The bugs the code names

Comments across the codebase say things like "which is B6" and "B11 in a second costume". Each names a
real defect whose fix shaped the code around it. This is what they refer to.

**Reconstructed from those comments**, the way `docs/adr/` was — they are the record, and they are
detailed. Where a comment already explains the defect fully and is the *only* place that names it, the
identifier was removed instead of registered: an id that links one place to nothing is a lookup with
no destination. That happened once; see the note at the end.

**These are history, not rules.** Every entry below is fixed, except `B15`, which is open and says so.
What makes them worth keeping is that most of them were *invisible* — they corrupted quietly, or leaked
quietly, and the thing that found them is usually the thing that now prevents them. `test/adr.test.ts`
checks that every `Bn` in the code still resolves here.

---

## B1 — an entity in no branch of the tree

The hierarchy is stored three times over: `child.parent`, `parent.children[]`, and `scene.rootOrder`
(ADR-0002). A reparent that wrote one and not the others left an entity with a `parent` pointing at
nothing and in no children list at all — **gone from the hierarchy, still drawn in the viewport, still
clickable**.

The specific hole: `isAncestorOf` answers `false` for an id the document does not hold, so the ancestor
guard alone looked like it had passed. It is not an existence check. Prefab expansion produces
`owner/local` ids that are not in `scene.entities`, and dropping onto one of those rows was enough.

It survived so long because the only thing checking the three copies was `repairHierarchy`, at load
time: an edit that broke an edge stayed broken all session and was quietly healed on the next open,
after the evidence was gone.

**What stops it now**: every hierarchy edit goes through `core/src/scene/graph.ts`, which checks before
it writes and refuses rather than corrupting; `documentStore` shouts in development when a mutation
leaves the tree inconsistent; and `SceneBinder` warns rather than silently reparenting to the root.

## B2 — undo left the gizmo pointing at something deleted

The selection was set *after* `mutate`, so no history entry described it and undo could not take it
back. Undoing an Add left the gizmo asking the binder for an object that no longer existed.

**What stops it now**: `selectionBefore` and `selectionAfter` are required fields on a history entry
(ADR-0009, invariant 2), and the selection is applied inside the transaction. The round-trip property
test covers the document *and* the selection — a property test that ignored the selection would have
passed straight through this.

## B3 — a document permanently marked modified, or permanently clean

Two halves of one mistake about what "unsaved" is.

`dirty` was a boolean, so undoing back to the last save left the document marked modified for ever. It
is now `revision !== savedRevision`.

And `replaceScene` forced the document clean in every case. That is right for a *load* — the result is
what the file holds — and wrong for a *restore*: Play/Stop and leaving Prefab Mode hand back a document
that was set aside, and a restore decides nothing about whether the work is saved. It lost unsaved work
with no warning. `keepHistory` is what tells the two apart.

## B4 — opening a prefab erased an hour of scene undos

History is deliberately not shared across the prefab-mode boundary. "Not shared" was implemented as
"destroyed": `open` cleared the stack rather than setting it aside, so an unlucky double-click on a
prefab threw away every scene undo with nothing to restore from.

**What stops it now**: `HistoryStash` — the stack, the future, `revision` and `savedRevision` as one
value, set aside and handed back. They travel together because `savedRevision` means nothing without
the `revision` it is compared to.

## B5 — the worst of the twelve: meshes freeing each other's material

Three meshes named the same material asset. One texture change gave each of them its own copy, and each
replacement freed the material the previous mesh had just adopted.

The cause was that every mesh decided *for itself*, inside `buildMaterialFor`, whether the asset's
definition had changed — each against its own stale `previous`. For N meshes on one asset, N of them
took the "it changed" branch.

**What stops it now**: `SceneBinder.setMaterialLibrary` reconciles once per asset, and
`ResourceArena.replaceMaterial` is called from that one place. The mesh and model systems are read-only
against the pool on that path.

## B6 — a GPU buffer freed while a pass was still reading it

The retire queue was drained by whatever ran next rather than by the frame. Its comment claimed the
queue was "a frame old now", which is true only if syncs come one per frame — and two paths break that
in opposite directions:

- `assetStore.refresh()` fires `onMaterialsChanged` then `onPrefabsChanged` back to back, each syncing,
  so one sync retired and the next freed **in the same microtask with no render between them**;
- a sync that finds nothing dirty returns early, so anything retired just before pressing Play stayed
  resident for the whole session.

`WebGPURenderer.render` returns a promise the loops do not await, so a buffer freed there is handed to a
pass still being encoded — a crash, not a dropped frame.

**What stops it now**: the queue is paced on the frame. `beginFrame()` is called once per rendered
frame, before anything else can retire more, and the queue lives in `ResourceArena` with the pools it
belongs to.

## B7 — a hidden entity was still clickable

three does not inherit `visible`, and **its raycaster does not test it at all**. Hiding an entity sets
the flag on the container above the mesh, so the mesh's own flag stayed true and the hidden object went
on catching clicks.

**What stops it now**: `Picker` walks up from the hit to check the whole chain, and viewport markers
carry their entity's visibility for the same reason.

## B8 — a model that landed after its entity was gone

glTF loading is asynchronous, so a model arrives one or more frames late. By then its entity may have
been edited, deleted, or **rebuilt under the same id**. The guard was a generation counter on the
binding, and a removed binding keeps its generation — so the guard passed and the model was attached to
a container nothing draws.

**What stops it now**: the identity checked is the **handle**, not the entity. A delete followed by a
rebuild under the same id produces a new handle, so the late arrival is dropped. Only the reconciler
knows what is currently mounted, so the check is its, not the systems'.

## B9 — a shadow map allocated per frame of a slider drag

`EntityDoc.components` was an array, and touching one field changed the array's identity — so the
binder rebuilt every non-mesh component of that entity. A directional, spot or point light allocates a
render target of `shadowMapSize` squared (2048 by default, up to 4096) that only `dispose()` frees.
Dragging an intensity slider allocated one per frame and abandoned the last.

**What stops it now**: components live in tables (ADR-0003) and are compared element by element, so an
untouched component keeps immer's identity. And a system answers `patch` or `'remount'`: `LightSystem`
writes intensity in place, and only says `'remount'` when the class itself has to change — which is
what lets the caller free the shadow map deliberately. A projector's cookie is swapped in place for the
same reason: changing which picture a light throws should not cost a shadow-map reallocation.

## B10 — a prefab override that landed on the wrong component

Overrides named a component by its **position** in the array. Inserting a component into a prefab slid
every override of every instance one place along: mass landed on the collider, and the override that
had been last landed on nothing. Removing one paired a cube's build with a sphere's component.

**What stops it now**: every component carries an id and an override names it (ADR-0004). An override
whose component is gone is dropped rather than applied to a neighbour. The migration derives ids from
where components already are, so a scene and the prefabs it places agree without either reading the
other.

## B11 — the padlock did nothing

`entity.locked` existed from the first version and **was read by nobody**. Everything that offered an
action — the gizmo, the picker, the context menu, the shortcuts — asked its own question in its own
way.

It came back in a second costume after the capability existed: `Cmd+G` asked `Selection.can('group')`,
which a lock refuses, while Add ▸ Group Selection asked `selection.length === 0`, which it does not. The
menu grouped the object the shortcut had just refused to touch. Three callers out of four used the
capability.

**What stops it now**: `capabilitiesOf` is the one derivation, and the command registry is the one place
each gesture's verdict is written.

## B15 — a shadow frustum narrower than the field, and it is open

Not fixed. A `BatchedMesh` gives up per-instance frustum culling as soon as anything in the scene casts
a shadow: a shadow render is nested *inside* the lit material's node update, so it overwrites the
multi-draw list between the object's `onBeforeRender` and its draw. A shadow frustum narrower than the
field left 178 of 2000 crates on screen.

Measured on 3600 spheres with a shadowed sun: as shipped 3600/3600 drawn at 11.7 ms; culling forced on,
**30**/3600 at 8.2 ms — faster because the scene had disappeared. Thirty is what the sun's 5-unit ortho
box holds.

What *was* closed is the neighbouring waste: sorting is off on batches, because `onBeforeRender` returns
early only when visibility, per-instance culling and sorting are all off — with sorting on it rebuilt
the list for every camera, including the six faces of a point light's shadow map. Front-to-back order
buys nothing for opaque geometry.

See `MeshBatcher.createBatch` and `docs/chantier/RESTES.md`.

---

## What is not here

**B12** was registered nowhere and cited once, in `EditorViewport`: the fallback lighting pair was
asked of the *document* rather than of the expanded scene, so a level whose lights all come from prefab
instances kept the fallback on over its real ones and was lit twice. Its one comment says all of that,
so the identifier was removed and the sentence kept. An id that links one place to nothing is a lookup
with no destination.

**B13 and B14** are cited nowhere and nothing in the code says what they were. They are listed here so
that the gap reads as known rather than as an omission.
