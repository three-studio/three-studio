# Texture and mesh compression enters through the importers

**Status**: accepted. What is decided here is *where* compression enters, not that it is built — no
compression exists in the codebase today, and this document is a reason not to build one in a hurry.

## Context

An exported build copies the author's files byte for byte. A 2048² base-colour PNG is several
megabytes; the same image as ETC1S in a KTX2 container is a few hundred kilobytes and stays compressed
on the GPU rather than being expanded on upload. A Draco-compressed glTF is routinely a fraction of the
size it arrived at. For a game that has to finish downloading before it starts, this is the largest
single lever on how long a player looks at nothing.

The absence has been read as debt more than once, most recently while building the size report — which
is precisely the screen that makes it visible. It is not debt. Nothing was compressed and then
un-compressed; no shortcut was taken that has to be repaid. It is a feature nobody has written yet, and
mistaking it for a defect pushes towards building an extension point for it now, with no implementer to
shape it — the one kind of extension point this codebase has decided not to build.

What *is* worth settling, while the export pipeline is still fresh in mind, is where it would enter.
There are two plausible answers and only one of them keeps the editor and the build showing the same
thing.

## Decision

Compression enters through the **importer seam** — `AssetImporter` and its subclasses in
`packages/core/src/assets/import/`, one per format — and not through the exporter.

Three properties of that seam decide it:

1. **It already owns the per-format questions.** `TextureImporter.fields()` is where colour space,
   wrap, mipmaps and anisotropy are asked; `ModelImporter.fields()` is where scale and up-axis are. A
   compression choice is the same kind of question: about one file, in one format, answered once by
   someone who is looking at it.
2. **Its answers are persisted per asset, in a shape that may only grow.** They live in
   `AssetSettings` inside the sidecar, and a field added later is filled from
   `defaultSettings(fileName)` — so a compression field costs no migration and no second list of
   defaults kept in step with the first.
3. **Its answers are read everywhere, through one interface.** `AssetResolver.settings()` is how all
   three consumers — the editor viewport, play mode, and an exported build's player — learn what the
   author chose. A setting that arrives there applies identically in all three. Nothing else in the
   codebase has that property.

The third is the one that matters most, because compression is *lossy and visible*. ETC1S puts blocks
in a smooth gradient; Draco quantises positions, normals and UVs. Decided at the importer seam, the
artefact appears in the viewport, next to the checkbox that caused it, while the author still has the
uncompressed file. Decided anywhere else, the first place it appears is the shipped build.

`sniffTextureEncoding` is the precedent: a fact that needs the bytes, worked out once at import,
written into the sidecar, read by every consumer — so no loader ever fetches a file twice to find out
what it is. Compression is the same shape of fact with a bigger payoff.

## Why not the exporter

The exporter is the obvious-looking home — it is the thing that produces the file people download — and
it is the wrong one, for four separate reasons.

**It is a copier, not a toolchain.** `exportBuild` says so in its own header: no bundler runs there,
because an export must not depend on a toolchain being installed next to the app. Draco and Basis
*encoders* are native binaries or heavyweight WASM, per platform. Compressing at export means either
shipping encoders inside the Electron app for three platforms, or having export fail on a machine that
lacks them. Both are exactly the dependency that line exists to refuse. Note the asymmetry that runs
through this whole decision: *decoding* in the player is a file to serve; *encoding* is a toolchain.

**The cadence is wrong.** Import happens once per file, behind a dialog the author already accepted
and already waits on. Export happens every time the author wants to look at the result. Encoding a 2K
texture to ETC1S is seconds, and UASTC is worse; a dense mesh through Draco likewise. A build that the
size report currently measures in seconds would take minutes, on every export, to redo work whose
inputs did not change. Content-hashed asset names already cost one extra read per asset per export, and
that was weighed before it was accepted; a re-encode is a different order of magnitude.

**The answers would have nowhere to live.** The exporter is handed a `BuildProfile`, which is per
build. Compression is not per build: a normal map needs UASTC or it is visibly wrong, an albedo is fine
in ETC1S, and a data texture — a mask, a lookup — must not be touched at all. A single knob on the
profile would decide for every file in the project. Per-asset answers belong in the per-asset sidecar,
and that sidecar is the importer's.

**It would be invisible exactly where being visible is the point.** The author would ship artefacts
they never saw, in the one build they cannot iterate on cheaply.

## What it would require of the player

The three formats usually named in one breath are not one problem.

**WebP requires nothing.** It is already in `TextureImporter.extensions`, already decoded by the
browser, already previewable in the import dialog. Transcoding a PNG to WebP at import is an importer
change and stops there. It is the cheapest of the three and the one to do first.

**KTX2/Basis and Draco require decoders that are not modules.** `loadModelFromUrl` already says this in
a comment, and this section is the long form of it. Meshopt is wired up because
`meshopt_decoder.module.js` is a plain ES module that bundles like any other import. The other two are
WASM plus a JS wrapper that has to be *served* — next to the editor and next to an exported build:

| | files | size |
|---|---|---|
| Draco, glTF variant | `draco_decoder.wasm` + `draco_wasm_wrapper.js` | ≈ 250 kB |
| Basis | `basis_transcoder.wasm` + `basis_transcoder.js` | ≈ 575 kB |

In the runtime, that is four changes and one of them is not local:

- `loadModelFromUrl` gains `setDRACOLoader` and `setKTX2Loader` on the glTF loader, and therefore needs
  to know *where the decoders are served from* — which it has no way of knowing today: it takes a URL
  and a `LoadingManager` and nothing else.
- `ModelCache.textureLoaderFor` replaces the `ktx2` warning it currently emits with the real loader.
- `KTX2Loader.detectSupport(renderer)` needs the renderer, to learn which compressed formats the device
  actually has, and `ModelCache` does not take one. Both consumers do build the renderer before the
  `SceneHost` that owns the cache, so the value exists to pass — but `SceneHost`'s preloader is
  deliberately built to work *before* an engine does, so whatever plumbs the renderer through must not
  make the cache depend on one.
- `applyTextureSettings` acquires two fields it can no longer honour. A KTX2 texture cannot be flipped
  on upload, and its mip chain comes out of the file rather than being generated, so `flipY` and
  `generateMipmaps` stop being the author's choice for those files and become the format's. The dialog
  has to say so, or the author sets them and watches nothing happen — one more reason the compression
  choice belongs beside them rather than three layers away.

The CSP is already paid for: `security.ts` allows `blob:` in `script-src` and `worker-src` precisely
because these loaders spawn blob workers.

And the exporter does gain exactly one thing — it has to put the decoders in the build. Two shapes:

- drop them in `apps/web-template/public/`, and every build carries ~0.8 MB whether or not it holds a
  single compressed asset — on the very size report that would have prompted the work;
- or copy the decoder a build actually needs, which the sidecars already know, since they record the
  format of every asset the build contains.

The second is the one to take. It also keeps the template opaque to the exporter, which is a constraint
the exporter already lives under: the decoders would be a third source it copies from, beside the
player and the assets, rather than a directory *inside* the player that it has to know the layout of.
And it is still the exporter copying a file, never running an encoder — which is the distinction this
whole decision turns on.

## One thing compression must not break

A `.gltf` names its buffers and images inside the file, relative to itself. Content-hashed asset names
hash the model and deliberately leave its companions alone for that reason. Compressing a texture that
a `.gltf` references by name is the same hole from the other side: the reference goes stale unless the
`.gltf` itself is rewritten.

So this starts with standalone textures, which are the easy case and the common one. A model's own
embedded images need the model rewritten on the way in, and that is a second decision, not this one.

## What would trigger building it

A real project whose size report shows textures or meshes dominating, held by an author who cannot fix
it by resizing the source. Until then the report is the honest answer: it names the number, and this
document names what to do about it and in what order — WebP, then KTX2 for standalone textures, then
Draco.
