# The performance harness

Measures what the editor, Play, a device and an exported game cost — time, memory, draw calls — on generated
projects, so that a change can say what it did to them in numbers rather than impressions.

It measures the **production build**: the bundles `electron-builder` packages, run unpackaged by the Electron
binary. A development build (unbundled modules, React's development build, the Vite client) says little about
what ships, and a packaged app costs a minute and 400 MB of scratch per launch for numbers that do not differ.

## Running it

```sh
npm run perf
```

builds the production bundles (`npm run build`), then runs `tools/perf/run.ts` under its own Vitest config
(`tools/perf/vitest.config.ts`): one worker, one scenario after another. It launches the editor some thirty
times and Chrome a few, each in the background and without taking the focus, so the Mac stays usable — but an
idle Mac measures better, and the run records the load average.

Every launch gets its own application data (`--user-data-dir` inside the run's folder), so a run never reads
or writes `~/Library/Application Support/Three Studio`.

The harness's own tests — the generators, the statistics, the CDP decoding — are in `test/` and run with
`npm test`.

## How a launch is driven

- **The editor** (`launch/electron.ts`): the Electron binary on `apps/desktop`, under the smoke harness
  (`STUDIO_SMOKE=1`, the project given, a setup that holds the window up until the driver sets
  `window.__perfDone`), with `--remote-debugging-port`, and in the *uncapped* mode
  `--disable-frame-rate-limit --disable-gpu-vsync`. Its own process group, ended whole on failure; its output
  in `<run>/logs/<label>.log`, where the harness prints `[smoke] renderer errors:`.
- **Attached once the editor's document has committed.** The page target exists before that document does,
  and running script in the empty one it starts with — `Runtime.evaluate`, `Runtime.enable` — makes
  Electron's sandboxed preload fail ("Cannot destructure property 'preloadScripts' of
  'binding.startupData'"), which the harness counts as a renderer error. `Page.getFrameTree` runs no script;
  polled until the frame is the editor's, it lets the driver in about a quarter of a second after
  navigation, well before a scene is drawn.
- **Page functions** (`page/`) are TypeScript, typechecked against the editor's own declarations
  (`packages/editor/src/devtools.ts`) and the harness's (`page/globals.ts`), and run with `toString()` through
  `Runtime.evaluate`. Each is whole in itself: no import but types, nothing from its module's scope.
  `test/pageFunctions.test.ts` holds every one to that.
- **Chrome** (`launch/chrome.ts`), for exported builds: `open -g -n` on a fresh profile in the run's folder, so
  every launch is a first visit behind the person's work; served from `127.0.0.1` (`launch/serve.ts`).

## The projects

Each scenario writes the scratch projects it measures, with the app's own code (`generate/projects.ts`): the
layout from `createProject`, sidecars and asset ids from `scanAssets`, scenes from `createScene` and
`saveScene`, models through `writeGlb`. Deterministic in everything measured; only the ids are random.

| Recipe | What | Written in |
|---|---|---|
| `render` | September's scene: 3 000 props on a 60 × 50 grid (6 shapes × 6 colours, 36 batches), a ground, a shadowed sun, 90 × 90 water, a main camera, the analytic sky; 3 004 entities, 5.4 MB | 0.1 s |
| `large` | 1 000 groups of 9 low-poly children on a 40 × 25 grid, a ground, a sun, a camera; 10 003 entities, 17 MB | 0.3 s |
| `assets` | the starter scene and 3 000 16 × 16 PNGs of distinct colours, in 30 folders | 3 s |
| `geometry` | one GLB, 331 MB: 30 groups × 50 meshes, each its own displaced 71 × 71 grid (float positions, normals and uvs, 16-bit indices), 8 untextured materials; about 15 million triangles; loaded as written | 6 s |
| `textures` | one GLB, 66 MB: 8 quads, each material with a base colour, a normal and a metallic-roughness PNG of 4096²; the default import caps them at 2 048 | 8 s |
| `scripted` | scenes `A` and `B` (100 props and a `Director` each), `Loading` (a spinning cube), `Heavy` (the `render` field); 50 ballast scripts of 200 lines on entities of `A`; no loading scene set | 0.3 s |

Times on an M1 Pro. Two recipes depend on the import pipeline, and say so:

- **`geometry` is loaded as written.** A new model above 2 MB is loaded through a copy whose geometry is
  quantised and meshopt-encoded, a quarter of the size. Right after the scan that makes its sidecar, the
  generator turns `compressGeometry` off, removes the copy, and scans again, which writes the `.none` marker:
  the editor, Play and the export read the source. A change to those rules fails the generators' test first.
- **`textures` keeps the default import**, which is what a user gets. In Node the scan cannot scale an
  embedded image (it takes Electron's `nativeImage`), so the capped copy is built by the editor's own first
  scan — the scenario's warm-up launch, before which an export would ship the 4096² sources.

## Options

| Variable | Effect |
|---|---|
| `PERF_OUT=<folder>` | Writes the run's report there, `<date>-<commit>-<label>.md` and its `.json` twin, compared with the newest run already in it. Without it the report is printed, and both files stay in the run's folder |
| `PERF_LABEL=<label>` | Names the run in its file name and its title; `run` otherwise |
| `PERF_LAUNCHES=<n>` | Measured launches per scenario; three otherwise |
| `PERF_SHOTS=<folder>` | A capture per reading, for checkpoints |
| `PERF_SCRATCH=<folder>` | The run's folder, kept whole at the end, with each scenario's prepared projects: the next run of this tree there goes straight to its measured launches |
| `PERF_RESULT=<file>` | The run's result JSON, alone: what an A/B reads from the other tree |
| `PERF_AGAINST=<commit>` | An A/B against that commit (below) |
| `-t S3` | One scenario, or several: `-t "S1 —\|S3 —"` |

These, the `vitest.config.ts` path and the result JSON — metrics by name, each with its kind, its unit and its
launches — are the interface an older tree keeps: later versions add variables and metrics, and none renames these.
A tree reads another's result through a decoder that leaves out a metric of a kind it does not know, and calls one
the other lacks *not comparable*.

## Reading a run

Each metric is one of four kinds:

- a **count** must stay identical: draw calls, triangles, bytes over IPC, chunk sizes. A count that moves is
  *changed*, and the feature that moved it says why;
- a **timing** or a **memory** is judged on its median over the launches, against the previous run's: within +5 %
  it is *ok*, beyond it *suspected* (D23). JS memory is the V8 heap plus the ArrayBuffers behind it;
- a **reported** value — a p95, a maximum, a growth, an allocation rate — is shown, never judged.

The previous run is the newest run JSON in `PERF_OUT` by its finish; an A/B's twin is never taken. Timings and
memory are *not comparable* when the machine, the system, Electron's Chromium, Chrome, three, the power source or
Low Power Mode differ, or the scenario's window: an A/B decides then.

## Confirming a breach

A suspected breach does not stop a feature: one launch of a busy Mac moves a median by 5 %. The run prints the
command that confirms it, an A/B against the previous run's commit:

```sh
PERF_AGAINST=<commit> npm run perf -- -t "S3 —"
```

The A/B makes a worktree of that commit inside the run's folder, its `node_modules` this tree's, builds it, and
alternates launches: the other tree's own harness for one (`PERF_LAUNCHES=1`, `PERF_RESULT`, its own
`PERF_SCRATCH`), then this tree's, as many pairs as a run has launches. Each tree prepares its projects once and
keeps them between its launches, so an A/B about doubles the time of what it confirms. A breach that holds on the
paired medians is *confirmed*, and only a confirmed one stops a feature until the user decides; a count needs no
confirmation. Each tree measures with its own harness and its own generators: an older tree may read another
format, or other editor internals.

The A/B writes `<date>-<commit>-ab-<other commit>.md` and its twin beside the run's own report, which is made of
this tree's side of the pairs. Run against this tree's own commit, an A/B measures each metric's noise — its
largest paired difference on identical code — which the baseline records and later reports show beside each change.

## Traps

- **September's: a layout saved by one launch decides the next.** The editor saves the dock's layout as it loads,
  and a layout comes back two pixels off: the edit canvas grew 4 × 2 device pixels a launch, the GPU memory with it.
  Every launch removes the harness's `layouts.json` first.
- **September's: a frame held to the display measures the display.** At 120 Hz a median frame time does not move
  until a frame misses its slot; frame costs are read *uncapped*.

Each of these cost a run before it was known.

- **The uncapped mode crashes the first GPU process.** On Electron 43, `--disable-frame-rate-limit` makes the
  GPU process exit at start (`GPU process exited unexpectedly: exit_code=11` in the launch's log). Chromium
  starts another before the editor asks for a device, and the editor runs as it should: no renderer error,
  the frame no longer held to the display. Every uncapped launch reports one (`gpuProcessCrashes`); one in a
  display launch, or two in any, is a real crash.
- **Uncapped, the compositor never captures.** `Page.captureScreenshot`, with or without
  `optimizeForSpeed`, and the screencast never answer in that mode. A capture of an uncapped launch reads the
  canvas instead (`toDataURL` inside a frame callback, before the frame is presented).
- **No CDP call is unbounded.** Every `send` refuses after its timeout (60 s unless the call says otherwise),
  so a call that never answers fails its launch, not the run: unbounded, the run waited for Vitest's
  half-hour timeout and left the editor running behind it.
- **A frame callback's argument is when the frame began.** A frame whose callbacks a long task held up began
  before whatever was called during that task — stamped with its argument, the player's first frame came
  before Play was pressed. Stamp with `performance.now()` inside the callback.
- **`pgrep -f` and `pkill -f` read a pattern opening with `--` as an option**, fail, and match nothing. A
  pattern such as `--user-data-dir=…` goes after `--`.
