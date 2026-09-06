# Three Studio

A 3D game editor in the spirit of Unity and Unreal, built on Three.js and Electron.

**The document is the truth, and three.js is a view of it.** A scene is plain
JSON — entities, components in tables, an environment — and everything drawn is
derived from it. That is what makes undo, save/load, the play-mode snapshot and
the web export fall out rather than each being built: they are all the same
document being written, restored or shipped. Nothing in the viewport is
authoritative about anything.

Three consumers read that document through **one** pipeline: the editor
viewport, play mode, and the player an exported build ships. They share
`packages/runtime`, so what an author sees while editing is what the game does.

**Where the reasoning lives.** Decisions are one file each in
[`docs/adr/`](adr/), and the code cites them by number — `test/adr.test.ts`
refuses a citation that resolves to nothing. Defects whose fix shaped the code
are in [`docs/bugs.md`](bugs.md), cited the same way. Neither is a changelog:
they exist so that a comment saying "which is B6" has somewhere to point.

## Setup

```bash
nvm use                 # v24.8.0 — Vite requires >= 22.12
npm install
npm run dev
```

If `npm run dev` fails with **`Error: Electron uninstall`**, the Electron binary was
not downloaded by the postinstall hook. Fetch it manually:

```bash
node node_modules/electron/install.js
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | electron-vite dev server + Electron, renderer HMR |
| `npm run build` | Production build into `apps/desktop/out` |
| `npm run dist` | Build + package for **this** machine into `apps/desktop/release` |
| `npm run dist:mac` / `dist:win` / `dist:linux` | Same, one platform explicitly — see Releases below |
| `npm run build:web` | Builds the web player into `apps/web-template/dist` |
| `npm run typecheck` | `tsc --noEmit` across every workspace, **tests included** — `apps/*/test/**` was outside the include list and is not any more |
| `npm run test` | Vitest — includes the package-boundary assertions |

### Releases

**One native runner per platform, always.** `esbuild` is a runtime dependency, not a build tool:
`apps/desktop/src/main/scripts.ts` calls it while the app is running to compile the project's
scripts. npm installs only the binary matching the machine doing the install, so `npm run dist:win`
from a Mac packages the macOS binary into a Windows app. Nothing fails. electron-builder is happy,
the installer opens, and then Play and `File > Export for Web` are both dead on the user's machine.
That is why there is no `dist:all` and why the matrix in `.github/workflows/release.yml` uses four
real runners rather than one with cross-target flags.

(The binary does escape the asar on its own — electron-builder's unpack detector treats any
extensionless file that reads as binary as executable code, and `@esbuild/<platform>/bin/esbuild`
qualifies. No `asarUnpack` entry is needed, and adding one would just rot.)

Cutting a release: bump the version in `package.json` **and** `apps/desktop/package.json`, commit,
then push a `v*` tag. The `verify` job refuses the tag if the two disagree — electron-builder stamps
the app from `apps/desktop/package.json`, not from the tag, and a release whose About box reads
`0.1.0` is worse than a failed build. Do not reach for `npm version --workspaces`:
`apps/web-template/package.json` pins `"@three-studio/core"` literally — `0.2.0` today — and bumping
core out from under it breaks resolution.

The icon lives at `apps/desktop/build/icon.svg`; `npm run icons --workspace @three-studio/desktop`
rasterises it into `build/icons/` (Windows and Linux) and `build/icon-mac.png` (macOS), both
committed. **macOS gets square-cornered artwork on purpose.** macOS 26 masks every legacy `.icns`
into its own rounded tile and draws the platter itself, so handing it the rounded plate renders one
rounded rectangle inside another. Squaring the corners lets the system cut them, and the tile keeps
`#1B1B1B` rather than the system's `#303130` — measured under both light and dark appearance, and
the system platter ignores the theme either way. `linux.icon` has to be named explicitly even
though `build/icons/` is a path electron-builder finds by itself: `LinuxTargetHelper` falls back to
`mac.icon` when `linux.icon` is unset, so setting one without the other packages the macOS artwork
into the deb.

The rest of the Linux block is there because the npm name is scoped. Left alone electron-builder
derives `@three-studiodesktop` from `@three-studio/desktop` and hangs the binary, the Exec line and
every installed icon path off it; the deb would be called `Three Studio`, which is not a legal
Debian package name; and `desktopName` has to be set in `package.json` so `StartupWMClass` matches
Electron's `app_id`, or a running window is not associated with its launcher entry. `homepage` and
`author` live in `apps/desktop/package.json` rather than the workspace root because that is the file
electron-builder reads, and the AppImage target refuses to build without a homepage.

The workflow builds macOS arm64 + x64, Windows x64, Linux x64 (AppImage and deb), then opens a
**draft** GitHub release with the installers attached. `publish: null` in `electron-builder.yml`
keeps the four packaging jobs from racing each other to create it. Everything is unsigned: signing
needs an Apple Developer ID and a Windows EV certificate, neither of which exists.

### The web player

`apps/web-template` is the player an exported game ships: a page, a canvas and
about a hundred lines that hand a scene document to the same engine play mode
uses. `npm run build:web` compiles it — with three, Rapier and the runtime —
into `apps/web-template/dist`, and `File > Export for Web` copies that folder
and adds the scenes, the assets and the compiled scripts.

**Three requests before the first frame**, not six: `build.json` carries the
rendering settings, the asset table, the materials and the prefabs together,
because four documents fetched in parallel is still four round trips on a cold
connection. Scenes are filed by id under `scenes/<id>.json`, with the names
beside them as an alias table so a script saying `load('Level2')` means the same
thing in the editor and in the build. Asset file names are **hashed by content**,
which the id-to-path indirection made free: a re-export with one changed texture
is cacheable everywhere else. The build writes a manifest of what it emitted, and
a size report says where the bytes went.

It is built ahead of time rather than at export time because a packaged app has
no bundler to run. `dev`, `build` and `dist` all build it first, so it is not a
step to remember; `dist` is a build artefact and is gitignored.

`STUDIO_SMOKE=1 npm run dev` boots the whole stack headlessly, prints what the
renderer actually painted, and exits. Use it when a window cannot be inspected
by hand — a blank window and a working window look identical in a build log.

- `STUDIO_SMOKE_SHOT=<path.png>` also captures the window (via `capturePage`, so
  no macOS screen-recording permission is involved).
- `STUDIO_SMOKE_SETUP=<js>` runs first and its return value is printed, to drive
  the editor into the state being checked. In dev the viewport is reachable as
  `window.__studioViewport` and the stores as `window.__studioStores`.
- `STUDIO_SMOKE_PROJECT=<path>` starts in the editor window on that project
  instead of the launcher. Driving the launcher through a picker from a script
  is a test of the picker, not of whatever is being checked.
- `STUDIO_SMOKE_SETTLE=<ms>` waits longer than the default 800 ms after the
  setup. A setup that reloads the window — switching scene does — has a whole
  renderer to start again before there is anything worth measuring.

**The flag changes three things in the product**, which is what makes some paths
uncheckable from here rather than merely awkward: unsaved-changes prompts are
skipped (window close, and switching scene), projects are kept out of the recent
list, and `beginQuit()` runs before `app.exit()` — without it the close handlers
saw `quitting` false and opened a launcher just before dying.

A check that opens a project destroys the window it is running in — the editor
is a different window — so the setup script ends there. That is reported rather
than hung on, but it is why the two windows are usually checked separately.
**Only the first window is drivable**: a second one opened by the setup runs no
script, so what it received is shown by the `[windows]` lifecycle trace in the
main process instead.

## Windows

Two *kinds*, as in Unity and Godot — a launcher that picks a project, and an
editor that edits one — but **one editor window per open scene**, not one in
total. `windows.ts` holds an `Editor[]`.

- A launcher chooses a project; that opens an editor and closes the launcher.
- **Opening a scene that is already open focuses its window** rather than making
  a second one on the same file — `isSceneOpenElsewhere`.
- Closing the **last** editor brings the launcher back. Closing one of several
  does nothing else.
- Closing the launcher quits, on macOS as everywhere else.
- All windows share one project. Opening another closes them one at a time, and
  a single cancel abandons the whole operation.
- What one window does to the project — creating, renaming or deleting a scene —
  reaches the others through `announce()`, a fan-out to every editor but the one
  that asked.

**Switching scene reloads the window** rather than swapping the document inside
it. See `docs/adr/0008-one-scene-per-window.md`: a reload gives a fresh document,
a fresh history and a teardown nobody can forget to write, and the renderer being
expensive is the argument *for* that rather than against — it owns a GPU device,
a physics world and a dock layout.

The role and the project arrive through the preload's `process.argv`, not over
IPC: they are needed before the first render, and asking for them would paint the
wrong shell for a frame. **The scene arrives in the URL instead**, because
`reload()` replays argv verbatim and the scene is the one thing about a window
that changes. `window.studio.windowRole`, `.projectPath` and `.sceneId` are what
the renderer reads.

## Controls

| Input | Action |
| --- | --- |
| Right button held | Mouse look; `WASD` to fly, `Q`/`E` down/up, `Shift` to boost |
| Wheel while looking | Adjust fly speed |
| Wheel | Dolly |
| Middle drag | Pan |
| `Alt` + left drag | Orbit the pivot |
| `F` | Frame the selection |
| `Q` `W` `E` `R` | Select / Move / Rotate / Scale |
| `Cmd/Ctrl` + `Z` / `Shift+Z` | Undo / redo |
| `Cmd/Ctrl` + `D` | Duplicate |
| `Cmd/Ctrl` + `G` | Group selection |
| `Cmd/Ctrl` + `S` | Save scene |
| `Cmd/Ctrl` + `Shift` + `P` | Command palette |
| `Delete` / `Backspace` | Delete selection |

**The modifier shortcuts are data**, in `shell/shortcutBindings.ts`, and can be
remapped: an author's changes live in `shortcuts.json` beside `layouts.json` in
the app's data directory, and are laid over the defaults. A binding mapped to
`null` frees a key. There is no UI for it yet. Menus draw their hints from the
same table, so a rebound key shows up beside the gesture without anything else
being edited.

The tool keys are the deliberate exception: they match on **physical position**
(`event.code`), so `Q`/`W`/`E`/`R` stay under the same fingers on AZERTY, which
is what Unity and Blender do. Modifier shortcuts match on the character the key
produces — matching those on position shipped a bug where `Cmd+Z` did nothing on
an AZERTY keyboard, because the key labelled Z reports `KeyW`.

## Layout

```
packages/core      Pure data: scene schema, project schema, serialization. No dependencies.
packages/runtime   The game engine: three.js + Rapier + script host. Never imports the editor.
packages/editor    Editor UI: React shell, dock layout, viewport tooling, inspector.
apps/desktop       Electron main / preload / renderer.
apps/web-template  The player an export is built around; `npm run build:web` produces its `dist/`.
```

**A component type is three folders that register themselves** —
`core/src/components/<type>/` for the schema and its defaults,
`runtime/src/components/<type>/` for the system that draws it,
`editor/src/components/<type>/` for the Inspector schema, the Add-menu entry and
the viewport marker. Nine files, and the Inspector comes for free: a component
declares its fields in the same vocabulary a script's properties use, so there is
no UI to write. Adding a type used to touch fourteen files spread across the
tree. What is still shared, and why it is the thing standing between this and
third-party extension, is in
[`docs/adr/0018-third-party-extension-enters-through-the-registries.md`](adr/0018-third-party-extension-enters-through-the-registries.md).

`packages/runtime` is deliberately free of any editor dependency so that
"export to web" is a plain bundle of that package rather than a refactor.
`test/architecture.test.ts` enforces that from the import graph — `core` imports
nothing but `.` and `node:`, `runtime` never reaches the editor, nobody reaches
into `apps/`, and there are no cycles. It replaced a regex scan that looked at
two directories and could not see a cycle at all; there were four.

**Each package has a build**, in two passes: `tsc -p tsconfig.build.json` writes
the type tree, then esbuild bundles the JS. Two passes because the repo's
TypeScript is the native compiler — it emits declarations but has no JS API, so
the usual `.d.ts` bundlers are out. And bundling is not an optimisation: the
sources use extensionless relative imports, which no consumer's Node could
resolve if they survived into the output.

During development the desktop app consumes the packages as **TypeScript
source** — `workspace-aliases.ts` maps `@three-studio/*` onto sibling source, so
Vite and electron-vite transpile them directly and there is nothing to rebuild
between edits. The build configs clear those `paths` deliberately, so a published
package resolves its siblings the way a consumer does: through `node_modules`, to
a `dist` that has to exist already.

## Importing an asset

Dropping a file on the Project panel opens the import dialog rather than
importing it. No *asset* reaches the project until **Import** is pressed: the
session lives in memory in the main process, holding the source paths and the
settings being edited, so abandoning the dialog — or crashing with it open —
leaves no file behind in `assets/`. A folder made from the destination browser
is the exception, and is meant to be one: it is written when it is named, and
cancelling the import does not take it away again.

The dialog fills the window bar a gutter, in three columns — what is coming in,
what it looks like and where it lands, and what it is being imported as. A model
gets a scene it can be turned around in, an image gets drawn on a chequerboard, a
sound gets a waveform and a play button; and a model's bounding box is reported
in the file's own units beside what the current scale makes of it. That line, and the
**Fit to 1 m** button next to it, are why the dialog exists: an FBX out of
Unreal is in centimetres, and a tree arrives 2746 units tall.

Under the preview is the destination, browsed rather than typed: folders are
navigable, the assets already in one are shown but inert, and the folder being
aimed at can be created, renamed or removed there. **Automatic** — the first row,
and what an empty destination has always meant — files each format under the
directory its importer names.

Renaming a folder is safe, and for a reason worth keeping in mind: an asset's id
lives in the `.meta.json` beside it and scenes only ever reference ids, so
renaming a directory carries every identity with it and nothing has to be
rewritten. Deleting is not safe in that way — it destroys ids that scenes are
still made of — so only an empty folder can be deleted, and emptying it is done
one asset at a time, where `deleteAsset` reports what each one would take.

```
packages/core/src/assets/import/     one importer per format, and what it asks
apps/desktop/src/main/import/        the session, and the commit that follows it
packages/editor/src/import/          the dialog, the previews, the plan
```

A format is a class. `AssetImporter` answers everything about a file that does
not need its bytes — whether we take it, where it lands, what settings it starts
with, which rows the dialog shows, which side files come along — and
`ImporterRegistry` asks them in order, because `.material.json`, `.prefab.json`
and a bare `.json` are all `.json`. `ModelImporter` holds the trunk every model
shares and each format adds only its difference, which is why `ModelSettings` is
a union on `format` rather than one type with three formats' fields in it.

The parts that cannot live in `core` — copying, hashing and sidecars in the main
process, probing and previewing in the renderer — find their importer by `id`.
What `core` cannot do itself is injected: `companions()` is handed a reader, so
following a `.gltf` into its buffers is testable without a filesystem.

**The settings are read.** `AssetResolver.settings()` carries them to the
loaders, so a model is the size it was imported at in the editor, in play mode
and in an exported build alike. One is still declared and not read, waiting on a
system that does not exist: `generateColliders` wants collider generation.
`AudioSettings` was the other, and the audio system reads it now — `gain` folds
into each voice's own gain node and `forceMono` is baked in when the clip is
decoded, because a downmix cannot be folded into a scalar.

`studio-import://session/<session>/<file>/<name>` is how the renderer reads a
file that is not in the project yet. It serves that file and the companions its
importer read out of it, and nothing else — without that allow list the scheme
would be an arbitrary read of the whole machine. Both ids sit in the path under
a constant host, because a host is case-insensitive and an id is not.

## Taking an imported model apart

A model arrives as one entity drawing a whole file, which is right for placing a
prop and useless the moment you want to move one door or give one panel a
different material. **Unpack Model** — in the hierarchy's context menu and at the
bottom of the Model pane — turns it into one entity per node of the file, and it
is Unity's "Unpack Prefab" and Godot's "Make Local" under a third name.

One-way, deliberately: the pieces stop following the file, which is the point. A
link that is sometimes live is the thing nobody can reason about later. What
makes it cheap is that nothing new is invented — a piece is an ordinary entity
carrying an ordinary `model` component that names *one node* of the file
(`nodePath`), so the gizmo, the hierarchy, undo, prefabs, the play-mode snapshot
and the web export all already work on it. `makePrefab` on the result gives the
whole thing back as one instanceable asset.

Three things that are not obvious and each cost something to learn:

**A node is addressed by child indices, not by name.** `'0.2.1'` is the root's
third child's second. A name is unique in neither glTF nor FBX — four meshes
called `Cube` is the common case — and `Object3D.clone(true)` preserves child
order, so an index survives every copy the cache hands out. `nodeName` is stored
beside it and checked, not trusted: changing an import setting afterwards can
insert a node and slide every index after it, and the name is what finds the
piece again.

**The paths are relative to the tree as the import settings dress it.** Both
`unpackModel` and `ModelSystem` go through `ModelCache` for exactly that reason.
A second, undressed load would hand back paths pointing at different nodes, and
the failure would be an unpacked model whose pieces are the wrong pieces.

**`ModelCache.loadNode` clones one node without its descendants.** Without the
first half, a two-hundred-node model would deep-clone the whole file two hundred
times to keep one node from each; without the second, every child would be drawn
twice — once under its parent's clone and once under its own.

Skinned models are refused. A `SkinnedMesh` reads its pose from bones elsewhere
in the same tree by object reference, and splitting the tree across containers
leaves it in a heap at the origin.

`ModelComponent.materialId` is the other half, and needs no unpacking to be
useful: it replaces the materials the file shipped with, on the whole model or on
one unpacked piece. Empty reads **From file**, where a mesh's reads *Embedded* —
a model has no embedded `MaterialDef` to fall back on.

## Sound

`packages/runtime/src/audio/` drives the Web Audio graph itself and imports
nothing from three — it speaks in triples of numbers, and the behaviour in
`behaviour/audio.ts` is what reads a world matrix. `THREE.Audio` was measured
and left alone: it refuses a second concurrent play, wires its gain to the
listener in its constructor, and splits positional from flat across two classes,
which leaves `spatialBlend` — a single 2D↔3D dial, as in Unity — nowhere to
live.

The context is a **parameter**, never a `new AudioContext()` inside a
constructor. Vitest runs under node, where the Web Audio types exist and the
values do not, so injecting it is what makes the mix, the crossfade, the voice
stealing and the cache eviction assertable at all. One context per window, two
root gains under it: the editor's audition and the running game cannot hear each
other, and only one user gesture is needed to start either.

    AudioAsset ─▶ AudioClipCache ─▶ Voice ─▶ AudioMixer ─▶ root ─▶ destination

A voice fans out into a dry branch and a panned one with complementary gains,
which is the only way to honour a continuous `spatialBlend`; the crossfade is
linear rather than equal-power because both branches carry the same signal.
Thirty-two voices at once, Unity's number, with the largest `priority` stolen
first and the oldest among equals. Buses are the flat enum the schema already
had — a graph of them is worth having once there are effects to route through,
and not before.

A browser will not start an audio context without a user gesture, and a context
has **four** states, not three: iOS parks one in `'interrupted'` for a phone
call, and code that only tests for `'suspended'` leaves the device silent for
the rest of the session. `isStopped()` is the only way to ask.

`docs/audio/` is the chantier: what was measured, what Unity, Unreal and Godot
each do, and what is deliberately left for later with the seam each one enters
through.

## Gestures

Every gesture an author can ask for is a **command** in
`editor/src/commands/registry.ts`: an id, a `label(ctx)`, a `can(ctx)` and a
`run(ctx)`. Menus, the context menu, the keyboard and the command palette all
derive from that one table — none of them decides for itself whether a gesture
applies.

That is not tidiness. Before it, the same decision was written in four places and
had already drifted: `Cmd+G` asked whether the selection could be grouped, which
a lock refuses, while the Add menu asked whether it was empty, which it does not
— so the menu grouped the object the shortcut had just refused to touch. The same
shape turned up on the scene menu (two entries with no guard at all), on the
prefab buttons (live in the Inspector, greyed in the hierarchy), and on rename,
which for a long time did nothing whatsoever.

- **`can()` is required**, not optional. An optional guard is a guard somebody
  forgets, which is exactly how the four callers drifted.
- **`run()` re-checks it**, so a caller that forgets to ask is still refused.
- **The ids come from the table** — `CommandId` is `keyof typeof COMMANDS` — so
  there is no list of them to keep in step, and a family of commands that is not
  spread into the table vanishes from the type rather than going quietly missing.
- **The command palette is a view over it**, filtered by `can()` and by what has
  been typed. It knows nothing about which gestures exist.

What is *not* a command: anything whose argument is a **value** rather than a
target — the name that was typed, the point a drop landed on, the component type
picked from a menu. Only the caller that produced the value could dispatch it.
The line is written at the top of `commands/sceneCommands.ts`.

## What covers what

Two rules, both learned from the import dialog.

**Layers are named, in one place.** `--z-index-*` in the `@theme` block of
`packages/editor/src/styles.css` declares the order — panel overlay, dialog,
menu, toast, prompt — and every surface uses the utility rather than a number
chosen where it happened to be written. `.studio-dock` carries
`isolation: isolate` so dockview's own z-indices (99 on every splitter, 1000 on
a drop zone) stay inside it; before that, the layout stayed draggable behind an
open modal.

**A surface that covers the editor says so.** `useOverlay` in
`state/overlayStore.ts` puts it on a stack; `useShortcuts` refuses to act while
the stack is not empty, and `Escape` goes to the top of it and nowhere else.
Focus is not enough to decide this — Tweakpane hands focus back to the body once
a field is committed, so `Cmd+Z` right after typing in a dialog undid an edit in
the scene behind it. `shortcutsApply` asks both questions, and
`packages/editor/test/shortcuts.test.ts` pins both.

## Changing a persisted format

A project on disk outlives every version of the editor that will ever open it,
so a change to any of these files is a change to a contract with people who
are not here to be asked:

| File | Versioned by |
| --- | --- |
| `project.json` | `PROJECT_FORMAT_VERSION` |
| `scenes/*.scene.json` | `SCENE_FORMAT_VERSION` |
| `assets/**/*.meta.json` | `ASSET_META_VERSION` |
| `assets/materials/*.material.json` | `MATERIAL_ASSET_VERSION` |
| the exported build | `BUILD_FORMAT_VERSION` |
| `layouts.json`, `recent-projects.json` (userData) | their own constants |
| compiled user scripts | `SCRIPT_API_VERSION` |

Four rules, each of which exists because breaking it has already cost us a
morning:

**Add fields, never remove them.** A field that is no longer used is
deprecated, not deleted: something out there still has a value in it, and the
version that wrote it may still be someone's daily driver. Delete it a year
later, in a version bump, with a migration.

**Fill missing fields from the type's own factory, never from a list.** Every
migration merges `{ ...createThing(), ...stored }`. A second list of defaults
kept in step with the first is a promise nobody keeps — texture slots and
geometry segments both shipped as `undefined` into three because the migration
had not been told about them. Going through the factory means a new property is
migrated by existing.

**Leave alone what you do not recognise.** A component type this build has
never heard of is copied through untouched. Filling it against a type we do not
have invents a shape, and the next save writes that invention over the author's
data.

**Defend at the boundary, not at every read site.** One migration on load, so
the rest of the code can assume the current shape. The alternative was tried:
the binder threw once per frame, and a slider bound to `undefined` took the
whole Inspector down.

The tests for all of this live in `packages/core/test/sceneMigration.test.ts`,
`apps/desktop/test/projectFile.test.ts` and
`apps/desktop/test/upgradeContracts.test.ts`. They write files in the old
shapes by hand rather than asserting on the current one, which is the only
version of this test that can fail usefully.

**A reference is an id, never a name and never a path** —
`docs/adr/0005-a-reference-is-an-identifier.md`. `startScene`, `loadingScene` and
every build profile name a `SceneDoc.id`; the name is for the person using the
editor and the path is where the file happens to sit, and both can change without
anything else moving. The version before this one stored paths, and renaming a
scene meant rewriting four separate lists — missing any of them produced a
project that opened on the wrong scene, or a build missing a level, with nothing
to connect the failure to the rename.

**`project.json` no longer holds the list of scenes at all.** Every
`scenes/**/*.scene.json` *is* the list, walked on open and cached in
`.studio/scenes.index.json` by path, mtime and size. A stored list was a cache of
that walk that could go stale: a scene copied in the Finder was invisible, a
scene deleted there stopped the project opening, and two people each adding one
collided in the same three lines of JSON. A scene's **name** is its file name, so
renaming moves the file — `docs/adr/0006-a-scenes-name-is-its-file-name.md`.

## Notable version constraints

- **Vite is pinned to 7.x**, not 8 — `electron-vite@5` peer-requires `^5 || ^6 || ^7`.
  `@vitejs/plugin-react` is pinned to 5.x for the same reason.
- **`apps/desktop` is CommonJS** while everything else is ESM. Sandboxed Electron
  preload scripts cannot be ES modules.
- **Rapier's JavaScript binding is `@dimforge/rapier3d-compat@0.20.0`.** The
  `0.3x` numbers belong to the Rust crate. `@types/three` pulls its own nested
  `0.12.0` copy for typings, so `npm ls @dimforge/rapier3d-compat` shows two —
  the one under `@three-studio/runtime` is the one that runs.
- **TypeScript 7 removed `baseUrl`.** `paths` in `tsconfig.base.json` resolve
  relative to that file.
