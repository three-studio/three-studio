/**
 * The measurement the baseline is made of. Run it as the smoke harness's setup
 * script — see `docs/chantier/PERF-BASELINE.md` for the command line.
 *
 * All three readings happen in **one** pass of the application. Frame times
 * compared across two launches are noise: a different thermal state, a different
 * set of shaders already compiled, a different window size. These are taken
 * seconds apart on one device, one canvas and one renderer, which is the only
 * comparison that means anything.
 *
 * It reads two things the application does not publish — `EditorViewport.view`
 * and `BatchedMesh._multiDrawCount` — because neither has a public spelling and
 * both are the difference between a number and a number that can be read. A
 * measurement script is allowed to; nothing ships this.
 */
(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // The harness gives the page three seconds before running this, which is
  // enough for an ordinary scene and not for a five-megabyte one: on a cold run
  // the viewport did not exist yet and the whole measurement died on
  // `undefined.renderer`. Waited for rather than assumed.
  for (let i = 0; i < 120 && !window.__studioViewport; i++) await wait(250);
  if (!window.__studioViewport) return { error: 'the viewport never appeared' };

  const viewport = window.__studioViewport;
  const stores = window.__studioStores;
  const renderer = viewport.renderer;

  /** How many frames each reading is taken over, and how many are thrown away first. */
  const FRAMES = 300;
  const WARMUP = 60;

  /**
   * The camera pose, in the viewport, that the scene's own main camera has.
   *
   * Set rather than assumed: the editor camera starts at (8, 6, 12) looking at
   * the origin, which inside this scene is buried among the props with the whole
   * field behind it. Edit and Play would then be two different shots and the
   * numbers would not be comparable — which is the entire point of taking them
   * together. `HALF_Z + 40` and the pitch below are `make-scene.mjs`'s.
   */
  const HALF_Z = 87.5;
  viewport.camera.position.set(0, 30, HALF_Z + 40);
  viewport.camera.rotation.set(-Math.atan2(30, HALF_Z + 40), 0, 0);

  /**
   * How big each view is, and therefore how many pixels the frame owes.
   *
   * Reported per reading rather than once, because it changes between them: the
   * drawing surface is sized to the largest visible view, so a view coming or
   * going resizes it. A frame time compared without this is a comparison of two
   * different amounts of work.
   */
  const views = () => {
    const of = (view) => ({ width: view.width, height: view.height, visible: view.visible });
    return {
      scene: of(viewport.view.sceneView),
      game: of(viewport.view.gameView),
      surfaceWidth: viewport.view.surface.width,
      surfaceHeight: viewport.view.surface.height,
      pixelRatio: renderer.getPixelRatio(),
    };
  };

  /**
   * Waits until the frame being drawn is the whole scene.
   *
   * A reading taken while the binder is still building batches measures the
   * building, and three thousand entities take long enough for that to be most
   * of the window. Draw calls stay flat once the batches are up.
   */
  const settle = async (label) => {
    let last = -1;
    for (let i = 0; i < 60; i++) {
      await wait(250);
      const calls = renderer.info.render.drawCalls;
      if (calls > 0 && calls === last) return { settledAfterMs: i * 250 };
      last = calls;
    }
    return { settledAfterMs: null, warning: `${label} never settled` };
  };

  /**
   * What is resident on the GPU, in bytes, as three counts it.
   *
   * `info.memory` is three's own accounting and not an estimate of ours: every
   * buffer, texture and render target it allocates is added as it is created and
   * subtracted as it is freed. It is a running total for the whole renderer, so
   * a later reading includes everything an earlier one was already holding — the
   * editor viewport does not let go of its scene because the game started.
   */
  const memory = () => {
    const m = renderer.info.memory;
    return {
      total: m.total,
      attributes: m.attributes,
      attributesSize: m.attributesSize,
      indexAttributesSize: m.indexAttributesSize,
      textures: m.textures,
      texturesSize: m.texturesSize,
      renderTargets: m.renderTargets,
      programs: m.programs,
      geometries: m.geometries,
    };
  };

  /**
   * The batches, and whether their per-instance culling is culling anything.
   *
   * Without this the draw-call count cannot be read: three thousand entities
   * drawn in a few dozen calls is either batching working or batching drawing
   * everything regardless of the frustum, and `_multiDrawCount` against
   * `_instanceInfo.length` is the difference. See T-056 — a shadow-casting light
   * turns per-instance culling off, and this scene has one.
   */
  const batches = (root) => {
    let count = 0;
    let drawn = 0;
    let instances = 0;
    root.traverse((object) => {
      if (!object.isBatchedMesh) return;
      count += 1;
      drawn += object._multiDrawCount ?? 0;
      instances += object._instanceInfo?.length ?? 0;
    });
    return { count, drawn, instances };
  };

  /**
   * Frame times over `FRAMES` frames, and what the renderer drew in them.
   *
   * The stats are sampled per frame rather than read at the end: three resets
   * `info` once per animation frame, so a read placed anywhere else is reading
   * whatever the last frame happened to leave behind. Medians of the samples,
   * because the first frames after a batch rebuild are not the steady state.
   */
  const run = async (label, root) => {
    const settled = await settle(label);
    const deltas = [];
    const calls = [];
    const triangles = [];
    let last = performance.now();
    let frames = 0;
    await new Promise((resolve) => {
      const tick = () => {
        const now = performance.now();
        if (frames > WARMUP) {
          deltas.push(now - last);
          calls.push(renderer.info.render.drawCalls);
          triangles.push(renderer.info.render.triangles);
        }
        last = now;
        if (++frames < FRAMES) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });

    const at = (values, q) => {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
    };
    const round = (value) => Math.round(value * 100) / 100;

    return {
      ...settled,
      frames: deltas.length,
      frameMs: {
        median: round(at(deltas, 0.5)),
        p95: round(at(deltas, 0.95)),
        max: round(Math.max(...deltas)),
      },
      drawCalls: at(calls, 0.5),
      triangles: at(triangles, 0.5),
      views: views(),
      batches: batches(root),
      memory: memory(),
    };
  };

  const scene = stores.document.getState().scene;

  // Pin the dock before measuring anything. Every tab change is a layout change,
  // the dock persists those, and the file is shared by every project — so the run
  // before this one decides which tab the editor opens on. That is not a detail:
  // an inactive tab is parked off-screen at full window size, which changes the
  // drawing surface *and* takes the panel out of the compositor, and the edit
  // reading moved by 1.5 ms between two runs of the same script because of it.
  // Scene forward is the state an author edits in, so that is the state measured.
  window.__studioDockApi.getPanel('viewport')?.api.setActive();
  await wait(1000);

  await viewport.binder.whenLoaded();
  const edit = await run('edit', viewport.scene);
  edit.pools = viewport.binder.poolSizes;

  // Play, exactly as `startPlay` does it: the Game panel forward first, or the
  // game runs into a canvas no panel is showing.
  window.__studioDockApi.getPanel('game')?.api.setActive();
  stores.editor.getState().play();
  await wait(1000);
  for (let i = 0; i < 40 && !viewport.playEngine; i++) await wait(250);
  const engine = viewport.playEngine;
  if (!engine) return { error: 'the engine never started' };
  await engine.binder.whenLoaded();

  const play = await run('play', engine.scene);
  play.pools = engine.binder.poolSizes;
  play.warnings = stores.viewport.getState().playWarnings;

  // The same game with the Scene view detached. Dockview parks an inactive tab
  // off-screen at full size rather than collapsing it, so bringing the Game tab
  // forward does not stop the Scene view drawing — the two readings above and
  // below are what that costs.
  //
  // `detachScene()` and **not** closing the Scene panel, which was the first
  // version of this. Closing it is a layout change, the dock persists every
  // layout change to `layouts.json` in the user's app data, and that file is
  // shared by every project — so one measurement run left the editor with no
  // Scene tab, and the next two runs died because nothing was left to build the
  // viewport. A measurement must not be able to do that.
  viewport.detachScene();
  await wait(1000);
  const gameOnly = await run('game only', engine.scene);
  gameOnly.pools = engine.binder.poolSizes;

  // Left as found. The Game tab was brought forward above, and leaving it there
  // would hand the next run a different starting layout — see the note where the
  // dock is pinned.
  window.__studioDockApi.getPanel('viewport')?.api.setActive();
  await wait(500);

  return {
    scene: {
      name: scene.name,
      entities: Object.keys(scene.entities).length,
      batching: stores.project.getState().project.settings.rendering.batching,
      shadowMapSize: stores.project.getState().project.settings.rendering.shadowMapSize,
    },
    edit,
    play,
    gameOnly,
  };
})()
