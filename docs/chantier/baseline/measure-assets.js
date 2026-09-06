/**
 * What the asset index saves, measured through the running editor.
 *
 * Run it as the smoke harness's setup script, on a project built by
 * `make-scene.mjs` + `make-assets.mjs` — see `docs/chantier/PERF-BASELINE.md`.
 *
 * Every mutation in the Project panel ends in `assets:list`, which is
 * `scanAssets` over the whole tree; `assetStore` calls it from fourteen places.
 * So the cost of a rename *is* the cost of a scan, and that is what this times —
 * from the renderer, across IPC, exactly as the panel pays it.
 *
 * **The no-index reading is taken by invalidating, not by deleting.** The index
 * lives in `.studio/`, and nothing the renderer can reach will remove it: by the
 * time a setup script runs, the editor has opened the project and rebuilt it.
 * What the renderer *can* do is change every key — `FileIndex` is keyed on the
 * path relative to the project, so renaming all thirty folders makes all three
 * thousand entries miss, and the scan that follows reads and parses every
 * sidecar. That is the work a build without an index does on every single scan.
 * It is an upper bound rather than a measurement of that build: this one also
 * loads the old index and writes a new one, which a build without one does not.
 */
(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  for (let i = 0; i < 120 && !window.__studioStores; i++) await wait(250);
  if (!window.__studioStores) return { error: 'the stores never appeared' };
  const stores = window.__studioStores;

  const list = () => window.studio.assets.list();
  const round = (value) => Math.round(value * 10) / 10;

  const time = async (run) => {
    const started = performance.now();
    const value = await run();
    return { ms: round(performance.now() - started), value };
  };
  const timeOnly = async (run) => (await time(run)).ms;
  const median = (values) => [...values].sort((a, b) => a - b)[values.length >> 1];

  // The editor scans on its own when the Project panel mounts. Waited for rather
  // than raced: a reading taken while that scan is still running measures the
  // two of them fighting over the same three thousand files.
  for (let i = 0; i < 120 && stores.asset.getState().manifest.assets.length === 0; i++) {
    await wait(250);
  }

  const opening = await time(list);
  const manifest = opening.value;
  const leaves = manifest.folders
    .filter((folder) => /^textures\/pack-\d\d$/.test(folder))
    .map((folder) => folder.slice('textures/'.length));

  // --- the steady state -----------------------------------------------------
  const warm = [];
  for (let i = 0; i < 5; i++) warm.push(await timeOnly(list));

  // --- one asset renamed ----------------------------------------------------
  // A move is a rename on disk — `moveAsset` renames the file and its sidecar —
  // and it is the mutation the panel offers. One key changes, so exactly one
  // entry misses and exactly one sidecar is re-read.
  const sample = manifest.assets.find((asset) => asset.folder === `textures/${leaves[0]}`);
  const home = sample.folder;
  const away = `textures/${leaves[1]}`;

  const movedOut = await time(() => window.studio.assets.move(sample.path, away));
  const scanAfterMove = await timeOnly(list);
  const movedBack = await time(() => window.studio.assets.move(movedOut.value, home));
  const scanAfterMoveBack = await timeOnly(list);

  // --- one folder renamed ---------------------------------------------------
  // A hundred keys at once, which is the invalidation an author actually
  // triggers by renaming a folder in the panel.
  await window.studio.assets.renameFolder(`textures/${leaves[0]}`, `${leaves[0]}x`);
  const scanAfterFolderRename = await timeOnly(list);
  await window.studio.assets.renameFolder(`textures/${leaves[0]}x`, leaves[0]);
  const scanAfterFolderRenameBack = await timeOnly(list);

  // --- every entry missing --------------------------------------------------
  const renameAll = async (from, to) => {
    for (const leaf of leaves) {
      await window.studio.assets.renameFolder(`textures/${leaf}${from}`, `${leaf}${to}`);
    }
  };

  await renameAll('', 'x');
  const scanAllMissed = await timeOnly(list);
  const warmAfterAllMissed = await timeOnly(list);

  await renameAll('x', '');
  const scanAllMissedAgain = await timeOnly(list);
  const warmAgain = [];
  for (let i = 0; i < 3; i++) warmAgain.push(await timeOnly(list));

  // --- what the number is made of ------------------------------------------
  // A scan crosses the process boundary carrying every asset in the project, and
  // that crossing is not free: `AssetManifest` for three thousand assets is
  // hundreds of kilobytes, structured-cloned out of the main process and back
  // into the renderer on every single call. Timing a `structuredClone` here is
  // not the bridge — it is one copy where Electron does a serialise and a
  // deserialise — but it is the right order of magnitude, and without it the
  // scan and the crossing are one number that cannot be acted on.
  const clones = [];
  for (let i = 0; i < 5; i++) clones.push(await timeOnly(async () => structuredClone(manifest)));

  const final = await list();

  return {
    project: {
      assets: manifest.assets.length,
      folders: manifest.folders.length,
      entities: Object.keys(stores.document.getState().scene.entities).length,
    },
    // The first scan this script asks for. The editor has already scanned once
    // by now, so this is warm too — it is here to say so, not as a reading.
    openingScan: opening.ms,
    warm: { samples: warm, median: median(warm) },
    oneAssetRenamed: {
      move: [movedOut.ms, movedBack.ms],
      scan: [scanAfterMove, scanAfterMoveBack],
      total: [round(movedOut.ms + scanAfterMove), round(movedBack.ms + scanAfterMoveBack)],
    },
    oneFolderRenamed: { scan: [scanAfterFolderRename, scanAfterFolderRenameBack] },
    everyEntryMissed: {
      scan: [scanAllMissed, scanAllMissedAgain],
      warmAfter: [warmAfterAllMissed, ...warmAgain],
    },
    bridge: {
      manifestBytes: JSON.stringify(manifest).length,
      cloneSamples: clones,
      cloneMedian: median(clones),
    },
    // Proof the project came out of this the shape it went in.
    unchanged:
      final.assets.length === manifest.assets.length &&
      final.folders.length === manifest.folders.length,
  };
})()
