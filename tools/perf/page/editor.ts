/*
 * Page functions for the editor's window: run there by `runInPage`, so each is
 * whole in itself — see `launch/cdp.ts`. They reach the editor through the
 * handles `devtools.ts` declares on `window`.
 */

import type { AssetId, EntityId, SceneId } from '@three-studio/core';

/** Which of the editor's handles the window has, and whether it believes it has the focus: 1 or 0 each. */
export function editorHandles(): Record<string, number> {
  return {
    smoke: window.studio.smoke ? 1 : 0,
    stores: window.__studioStores === undefined ? 0 : 1,
    viewport: window.__studioViewport ? 1 : 0,
    dock: window.__studioDockApi ? 1 : 0,
    focused: document.hasFocus() ? 1 : 0,
  };
}

/** Lets the window go: the smoke harness's setup resolves, and the app exits. */
export function finishRun(): void {
  window.__perfDone = true;
}

/** Resolves once the viewport exists and its scene has loaded: how long that took since navigation, in ms. */
export function sceneLoaded(): Promise<Record<string, number>> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const check = (): void => {
      const viewport = window.__studioViewport;
      if (viewport) {
        void viewport.binder.whenLoaded().then(() => resolve({ loadedAt: performance.now() }), reject);
      } else if (performance.now() - started > 120_000) {
        reject(new Error('the viewport never appeared'));
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  });
}

/**
 * Puts the editor camera where the scene's main camera is, with its field of
 * view, so the edit view draws Play's shot. The editor camera starts close to
 * the origin, inside a field of props with the whole field behind it, and edit
 * and Play would then be two different amounts of work. Nothing moves it back:
 * the fly controls touch the camera only while the right button is held.
 */
export function poseEditorCamera(pose: {
  position: readonly [number, number, number];
  rotation: readonly [number, number, number];
  fov: number;
}): Record<string, number> {
  const viewport = window.__studioViewport;
  if (!viewport) throw new Error('no viewport');
  viewport.camera.position.set(...pose.position);
  viewport.camera.rotation.set(...pose.rotation);
  viewport.camera.fov = pose.fov;
  viewport.camera.updateProjectionMatrix();
  return { fov: viewport.camera.fov };
}

/**
 * Resolves once the frame draws a steady scene: draw calls above zero and the
 * same for `frames` frames running. A reading taken while the binder still
 * builds batches measures the building.
 */
export function settleDraws(frames: number): Promise<Record<string, number>> {
  return new Promise((resolve, reject) => {
    const viewport = window.__studioViewport;
    if (!viewport) {
      reject(new Error('no viewport'));
      return;
    }
    const started = performance.now();
    let last = -1;
    let steady = 0;
    const tick = (): void => {
      const calls = viewport.renderer.info.render.drawCalls;
      steady = calls > 0 && calls === last ? steady + 1 : 0;
      last = calls;
      if (steady >= frames) resolve({ drawCalls: calls, settledMs: performance.now() - started });
      else if (performance.now() - started > 60_000) reject(new Error(`draw calls never settled (last ${calls})`));
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/**
 * What the renderer drew in its last frame, and what it holds. three resets the
 * per-frame counters once per animation frame, not per render, so between two
 * frames they hold a whole frame: every view and pass it drew.
 */
export function rendererCounts(): Record<string, number> {
  const viewport = window.__studioViewport;
  if (!viewport) throw new Error('no viewport');
  const { render, memory } = viewport.renderer.info;
  return {
    drawCalls: render.drawCalls,
    triangles: render.triangles,
    textures: memory.textures,
    geometries: memory.geometries,
    programs: memory.programs,
    renderTargets: memory.renderTargets,
    gpuBytes: memory.total,
  };
}

/** The window and both views' canvases, in device pixels. */
export function windowShape(): Record<string, number> {
  const size = (view: string): { width: number; height: number } => {
    const canvas = document.querySelector(`canvas[data-view="${view}"]`);
    return canvas instanceof HTMLCanvasElement ? { width: canvas.width, height: canvas.height } : { width: 0, height: 0 };
  };
  const edit = size('edit');
  const game = size('game');
  return {
    innerWidth,
    innerHeight,
    devicePixelRatio,
    editWidth: edit.width,
    editHeight: edit.height,
    gameWidth: game.width,
    gameHeight: game.height,
  };
}

/**
 * Presses Play the way the toolbar does, and resolves once the game is on
 * screen: how long that took, and when the press was, in ms since navigation.
 */
export function pressPlay(): Promise<Record<string, number>> {
  return new Promise((resolve, reject) => {
    const stores = window.__studioStores;
    if (!stores) {
      reject(new Error('no stores'));
      return;
    }
    const pressed = performance.now();
    stores.editor.getState().play();
    const check = (): void => {
      if (stores.viewport.getState().gameShown) resolve({ gameShownMs: performance.now() - pressed, pressedAt: pressed });
      else if (stores.viewport.getState().rendererError !== null) reject(new Error('the renderer failed during Play'));
      else if (performance.now() - pressed > 120_000) reject(new Error('the game never showed'));
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
}

/** Presses Stop, and resolves once the editor is stopped. */
export function pressStop(): Promise<Record<string, number>> {
  return new Promise((resolve) => {
    const stores = window.__studioStores;
    if (!stores) throw new Error('no stores');
    const pressed = performance.now();
    stores.editor.getState().stop();
    const check = (): void => {
      if (stores.editor.getState().playState === 'stopped' && !stores.viewport.getState().gameShown) {
        resolve({ stoppedMs: performance.now() - pressed });
      } else {
        requestAnimationFrame(check);
      }
    };
    requestAnimationFrame(check);
  });
}

/**
 * A view's canvas as a PNG data URL, read inside a frame callback while the
 * frame's image is still there. For launches where the compositor never
 * captures — uncapped ones.
 */
export function canvasImage(view: string): Promise<string> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      const canvas = document.querySelector(`canvas[data-view="${view}"]`);
      resolve(canvas instanceof HTMLCanvasElement ? canvas.toDataURL('image/png') : '');
    });
  });
}

/**
 * Resolves at the first frame drawn with the entity's model in it: when, in ms
 * since navigation. `late` is 1 when the model was already there when this was
 * asked — the start was missed, and the reading is refused.
 *
 * The model's meshes, not `binder.whenLoaded()`: that answers "no model is
 * loading", which is as true before the model's load has begun as after it.
 */
export function firstFrameWithModel(entityId: EntityId): Promise<Record<string, number>> {
  return new Promise((resolve, reject) => {
    const hasMesh = (): boolean => {
      let found = false;
      window.__studioViewport?.binder.getObject(entityId)?.traverse((child) => {
        if ('isMesh' in child && child.isMesh === true) found = true;
      });
      return found;
    };
    const late = hasMesh() ? 1 : 0;
    const asked = performance.now();
    const check = (): void => {
      if (hasMesh()) requestAnimationFrame(() => resolve({ firstFrameAt: performance.now(), late }));
      else if (performance.now() - asked > 600_000) reject(new Error('the model never arrived'));
      else requestAnimationFrame(check);
    };
    check();
  });
}

/**
 * Selects an entity and deletes it with the editor's own key: `Delete`, on the
 * window, where the shortcuts listen. Resolves once the document no longer
 * holds it.
 */
export function deleteEntity(entityId: EntityId): Promise<Record<string, number>> {
  return new Promise((resolve, reject) => {
    const stores = window.__studioStores;
    if (!stores) {
      reject(new Error('no stores'));
      return;
    }
    stores.editor.getState().setSelection([entityId]);
    const pressed = performance.now();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', code: 'Delete', bubbles: true }));
    const check = (): void => {
      if (!stores.document.getState().scene.entities.has(entityId)) {
        resolve({ deletedMs: performance.now() - pressed });
      } else if (performance.now() - pressed > 10_000) {
        reject(new Error('Delete did not delete the entity'));
      } else {
        requestAnimationFrame(check);
      }
    };
    requestAnimationFrame(check);
  });
}

/**
 * Undoes the last edit with the editor's own key — Cmd+Z on the window, where
 * the shortcuts listen — and resolves at the first frame drawn with the
 * entity's model in it again: how long since the press, in ms.
 *
 * The model's meshes, not `binder.whenLoaded()`, for `firstFrameWithModel`'s
 * reason: nothing loading is as true before the reload has begun as after it.
 */
export function undoUntilModel(entityId: EntityId): Promise<Record<string, number>> {
  return new Promise((resolve, reject) => {
    const hasMesh = (): boolean => {
      let found = false;
      window.__studioViewport?.binder.getObject(entityId)?.traverse((child) => {
        if ('isMesh' in child && child.isMesh === true) found = true;
      });
      return found;
    };
    const pressed = performance.now();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', metaKey: true, bubbles: true }));
    const check = (): void => {
      if (hasMesh()) requestAnimationFrame(() => resolve({ restoredMs: performance.now() - pressed }));
      else if (performance.now() - pressed > 600_000) reject(new Error('the model never came back'));
      else requestAnimationFrame(check);
    };
    check();
  });
}

/**
 * Resolves at the first frame drawn with every one of these entities bound:
 * when, in ms since navigation. `late` is 1 when they all were already bound
 * when this was asked — the start was missed.
 */
export function firstFrameWithEntities(ids: readonly EntityId[]): Promise<Record<string, number>> {
  return new Promise((resolve, reject) => {
    const allBound = (): boolean => {
      const binder = window.__studioViewport?.binder;
      return binder !== undefined && ids.every((id) => binder.getObject(id) !== undefined);
    };
    const late = allBound() ? 1 : 0;
    const asked = performance.now();
    const check = (): void => {
      if (allBound()) requestAnimationFrame(() => resolve({ firstFrameAt: performance.now(), late }));
      else if (performance.now() - asked > 300_000) reject(new Error('the entities were never all bound'));
      else requestAnimationFrame(check);
    };
    check();
  });
}

/**
 * One edit, then the editor's own Save — Cmd+S on the window, where the
 * shortcuts listen — and how long until the document reads as saved, in ms.
 */
export function editAndSave(entityId: EntityId): Promise<Record<string, number>> {
  return new Promise((resolve, reject) => {
    const stores = window.__studioStores;
    if (!stores) {
      reject(new Error('no stores'));
      return;
    }
    const scene = stores.document;
    scene.getState().mutate('Nudge', (draft) => {
      const entity = draft.entities.get(entityId);
      if (entity) entity.transform.position[1] += 0.01;
    });
    const pressed = performance.now();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', metaKey: true, bubbles: true }));
    const check = (): void => {
      const state = scene.getState();
      if (state.savedRevision === state.revision) resolve({ saveMs: performance.now() - pressed });
      else if (performance.now() - pressed > 60_000) reject(new Error('the scene was never saved'));
      else setTimeout(check, 1);
    };
    check();
  });
}

/**
 * Duplicates what `ids` names with Cmd+D, then undoes it with Cmd+Z, each to
 * the first frame after the binder holds the result: how long each took, in
 * ms. The editor has no paste; Duplicate is the gesture that adds a thousand
 * entities in one undo entry.
 */
export function duplicateAndUndo(ids: readonly EntityId[]): Promise<Record<string, number>> {
  return new Promise((resolve, reject) => {
    const stores = window.__studioStores;
    const binder = window.__studioViewport?.binder;
    if (!stores || !binder) {
      reject(new Error('no stores or no viewport'));
      return;
    }
    const before = new Set(stores.document.getState().scene.entities.keys());
    const key = (letter: string): KeyboardEvent =>
      new KeyboardEvent('keydown', { key: letter, code: `Key${letter.toUpperCase()}`, metaKey: true, bubbles: true });
    const until = (done: () => boolean, then: () => void, what: string, started: number): void => {
      const check = (): void => {
        if (done()) requestAnimationFrame(then);
        else if (performance.now() - started > 120_000) reject(new Error(`${what} never finished`));
        else requestAnimationFrame(check);
      };
      check();
    };
    stores.editor.getState().setSelection(ids);
    const duplicated = performance.now();
    window.dispatchEvent(key('d'));
    const added = (): EntityId[] => [...stores.document.getState().scene.entities.keys()].filter((id) => !before.has(id));
    let made: EntityId[] = [];
    until(
      () => {
        made = added();
        return made.length > 0 && made.every((id) => binder.getObject(id) !== undefined);
      },
      () => {
        const duplicateMs = performance.now() - duplicated;
        const undone = performance.now();
        window.dispatchEvent(key('z'));
        until(
          () => added().length === 0 && made.every((id) => binder.getObject(id) === undefined),
          () => resolve({ duplicateMs, undoMs: performance.now() - undone, added: made.length }),
          'the undo',
          undone,
        );
      },
      'the duplicate',
      duplicated,
    );
  });
}

/**
 * The time between frames while one entity is moved every frame through the
 * document, under one coalescing key — the write the gizmo makes per frame of
 * a drag. `frames` of them, after `warmup` thrown away.
 */
export function dragDeltas(args: { entityId: EntityId; warmup: number; frames: number }): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const stores = window.__studioStores;
    if (!stores) {
      reject(new Error('no stores'));
      return;
    }
    const deltas: number[] = [];
    let last = -1;
    let seen = 0;
    const tick = (): void => {
      const now = performance.now();
      if (last >= 0 && seen > args.warmup) deltas.push(now - last);
      last = now;
      seen += 1;
      stores.document.getState().mutate(
        'Move',
        (draft) => {
          const entity = draft.entities.get(args.entityId);
          if (entity) entity.transform.position[0] += 0.01;
        },
        { coalesceKey: 'perf-drag' },
      );
      if (deltas.length < args.frames) requestAnimationFrame(tick);
      else resolve(deltas);
    };
    requestAnimationFrame(tick);
  });
}

/**
 * The time between frames while the Hierarchy scrolls `rows` rows a frame: the
 * list is the element whose content is `rowCount` rows tall.
 */
export function scrollDeltas(args: {
  rowCount: number;
  rowHeight: number;
  rows: number;
  warmup: number;
  frames: number;
}): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const list = [...document.querySelectorAll('div')].find(
      (element) => element.scrollHeight >= args.rowCount * args.rowHeight && getComputedStyle(element).overflowY === 'auto',
    );
    if (!list) {
      reject(new Error(`no element scrolls ${args.rowCount} rows tall`));
      return;
    }
    list.scrollTop = 0;
    const deltas: number[] = [];
    let last = -1;
    let seen = 0;
    const tick = (): void => {
      const now = performance.now();
      if (last >= 0 && seen > args.warmup) deltas.push(now - last);
      last = now;
      seen += 1;
      list.scrollTop += args.rows * args.rowHeight;
      if (deltas.length < args.frames) requestAnimationFrame(tick);
      else resolve(deltas);
    };
    requestAnimationFrame(tick);
  });
}

/** Where the Hierarchy's list stands: its first row on screen, and how many rows it holds. */
export function hierarchyScroll(args: { rowCount: number; rowHeight: number }): Record<string, number> {
  const list = [...document.querySelectorAll('div')].find(
    (element) => element.scrollHeight >= args.rowCount * args.rowHeight && getComputedStyle(element).overflowY === 'auto',
  );
  if (!list) throw new Error(`no element scrolls ${args.rowCount} rows tall`);
  return { firstRow: Math.floor(list.scrollTop / args.rowHeight), rows: Math.round(list.scrollHeight / args.rowHeight) };
}

/** Resolves once the Project panel's store holds `count` assets: the project's scan has arrived. */
export function assetsLoaded(count: number): Promise<Record<string, number>> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const check = (): void => {
      const assets = window.__studioStores?.asset.getState().manifest.assets.length ?? 0;
      if (assets >= count) resolve({ assets, loadedAt: performance.now() });
      else if (performance.now() - started > 120_000) reject(new Error(`the store holds ${assets} assets, not ${count}`));
      else setTimeout(check, 50);
    };
    check();
  });
}

/** One `studio.assets.list()` — the scan, over IPC — timed in ms. */
export async function listAssets(): Promise<Record<string, number>> {
  const started = performance.now();
  await window.studio.assets.list();
  return { ms: performance.now() - started };
}

/**
 * One store action, as the Project panel calls it, timed in ms: the IPC, the
 * main process's work, and the store adopting what came back. Refused when
 * the store says it failed, since a failed move times nothing.
 */
export async function assetAction(
  action: { kind: 'move'; path: string; folder: string } | { kind: 'renameFolder'; folder: string; name: string } | { kind: 'refresh' },
): Promise<Record<string, number>> {
  const store = window.__studioStores?.asset;
  const registries = window.__studioRegistries;
  if (!store || !registries) throw new Error('no stores');
  const started = performance.now();
  if (action.kind === 'move') await store.getState().move(action.path, action.folder);
  else if (action.kind === 'renameFolder') await store.getState().renameFolder(action.folder, action.name);
  else await store.getState().refresh(registries);
  const ms = performance.now() - started;
  const error = store.getState().error;
  if (error !== null) throw new Error(`${action.kind} failed: ${error}`);
  return { ms };
}

/** Resolves once the running game has published its scene API from `name`: its Director has started. */
export function sceneApiFrom(name: string): Promise<Record<string, number>> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const check = (): void => {
      if (window.__perfScenes?.current === name) resolve({ readyMs: performance.now() - started });
      else if (performance.now() - started > 120_000) reject(new Error(`scene ${name} never published its API`));
      else setTimeout(check, 20);
    };
    check();
  });
}

/**
 * Goes to each scene in turn through the game's own scene API — what a
 * script calls — each to the first frame after the viewport runs it: the
 * times, in ms. The API reaches the host, so the first one published serves
 * every switch. Refused if the loading scene ever runs in between: these
 * switches are timed with none.
 */
export function switchScenes(args: {
  order: readonly { name: string; id: string }[];
  loadingId: string;
}): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const stores = window.__studioStores;
    const api = window.__perfScenes;
    if (!stores || !api) {
      reject(new Error('no stores, or no scene API published'));
      return;
    }
    const times: number[] = [];
    const next = (index: number): void => {
      const target = args.order[index];
      if (target === undefined) {
        resolve(times);
        return;
      }
      const started = performance.now();
      const shown = (): void => {
        const running = stores.viewport.getState().runningScene;
        if (running === args.loadingId) reject(new Error('the loading scene ran between two switches'));
        else if (running === target.id) {
          requestAnimationFrame(() => {
            times.push(performance.now() - started);
            next(index + 1);
          });
        } else if (performance.now() - started > 60_000) reject(new Error(`scene ${target.name} never ran`));
        else requestAnimationFrame(shown);
      };
      api.go(target.name).then(shown, reject);
    };
    next(0);
  });
}

/**
 * Goes to `target` with the project's loading scene up meanwhile, to the
 * target's first frame: how long, the longest frame on the way, how many
 * frames were drawn, the shader programs its first frame created, and 1 when
 * the loading scene did run in between.
 *
 * The programs say what a compile ahead left to the start frame: those of the
 * node graphs the world draws, keyed by node id, and those of the batches
 * formed as the scene starts.
 *
 * The target's first frame counts: the frame after the store names the target
 * is the one that draws it, and it is the longest of all — its pipelines and
 * its images uploaded. Left out, the measure ended a frame early, and only
 * where a host told the store before drawing did that frame fall inside it.
 */
export function goThroughLoading(args: { target: { name: string; id: string }; loadingId: string }): Promise<Record<string, number>> {
  return new Promise((resolve, reject) => {
    const stores = window.__studioStores;
    const api = window.__perfScenes;
    if (!stores || !api) {
      reject(new Error('no stores, or no scene API published'));
      return;
    }
    const started = performance.now();
    let last = started;
    let longest = 0;
    let frames = 0;
    let sawLoading = 0;
    const tick = (): void => {
      const now = performance.now();
      longest = Math.max(longest, now - last);
      last = now;
      frames += 1;
      const running = stores.viewport.getState().runningScene;
      if (running === args.loadingId) sawLoading = 1;
      if (running === args.target.id) {
        const programs = (): number => window.__studioViewport?.renderer.info.memory.programs ?? Number.NaN;
        const atActivation = programs();
        requestAnimationFrame(() => {
          const end = performance.now();
          resolve({
            ms: end - started,
            longestFrameMs: Math.max(longest, end - last),
            frames: frames + 1,
            startPrograms: programs() - atActivation,
            sawLoading,
          });
        });
      } else if (now - started > 120_000) reject(new Error(`scene ${args.target.name} never ran`));
      else requestAnimationFrame(tick);
    };
    api.go(args.target.name).catch(reject);
    requestAnimationFrame(tick);
  });
}

/** Makes a scene the project's loading scene, or none, as the Project Settings dialog does. */
export async function setLoadingScene(id: SceneId | null): Promise<Record<string, number>> {
  const saved = await window.studio.project.updateSettings({ loadingScene: id });
  window.__studioStores?.project.getState().adoptProject(saved);
  return { set: id === null ? 0 : 1 };
}

/**
 * Places `count` of a prefab in the running world, one per slot of a grid in
 * the air, `columns` a row and `spacing` apart at `height`, then runs the
 * world's pass, all in one task: how long, in ms. Scripts cannot spawn yet, so
 * the page drives the world. What was placed is kept slot by slot in
 * `__perfCrates`, for the next call.
 */
export function spawnCrates(field: {
  prefab: AssetId;
  count: number;
  columns: number;
  spacing: number;
  height: number;
}): Record<string, number> {
  const world = window.__studioViewport?.playWorld;
  if (!world) throw new Error('no running world');
  const rows = Math.ceil(field.count / field.columns);
  const crates: EntityId[] = [];
  const started = performance.now();
  for (let slot = 0; slot < field.count; slot += 1) {
    const crate = world.instantiate(field.prefab, {
      transform: {
        position: [
          ((slot % field.columns) - (field.columns - 1) / 2) * field.spacing,
          field.height,
          (Math.floor(slot / field.columns) - (rows - 1) / 2) * field.spacing,
        ],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    });
    if (crate === null) throw new Error(`the running world has no prefab ${field.prefab}`);
    crates.push(crate);
  }
  world.reconcile();
  const ms = performance.now() - started;
  window.__perfCrates = crates;
  return { ms, crates: crates.length };
}

/** Destroys what `spawnCrates` placed, then runs the world's pass, in one task: how long, in ms. */
export function destroyCrates(): Record<string, number> {
  const world = window.__studioViewport?.playWorld;
  const crates = window.__perfCrates;
  if (!world || !crates) throw new Error('no running world, or no crates placed');
  const started = performance.now();
  for (const crate of crates) world.destroy(crate);
  world.reconcile();
  const ms = performance.now() - started;
  window.__perfCrates = [];
  return { ms, crates: crates.length };
}

/**
 * Raises or lowers the flag the `dynamics` recipe's `Spawner` script churns
 * under: the page's churn, done by a script through the façade.
 */
export function setScriptChurn(on: boolean): Record<string, number> {
  window.__perfChurn = on;
  return { on: on ? 1 : 0 };
}

/**
 * The time between frames for `ms`, in ms, while the `Spawner` churns, then
 * its flag lowered: the script does the work, the page only watches.
 */
export function churnByScript(ms: number): Promise<number[]> {
  return new Promise((resolve) => {
    const deltas: number[] = [];
    let started = -1;
    let last = -1;
    const tick = (): void => {
      const now = performance.now();
      if (last >= 0) deltas.push(now - last);
      else started = now;
      last = now;
      if (now - started < ms) {
        requestAnimationFrame(tick);
        return;
      }
      window.__perfChurn = false;
      resolve(deltas);
    };
    requestAnimationFrame(tick);
  });
}

/**
 * A churn of `ms`: at each frame the `perFrame` oldest crates are destroyed
 * and as many placed in their slots, so that as many stay alive as
 * `spawnCrates` placed. Each slot's crate is the oldest when its turn comes
 * round, and the one it replaces has fallen from it meanwhile. The time
 * between frames, in ms.
 */
export function churnCrates(args: {
  prefab: AssetId;
  count: number;
  columns: number;
  spacing: number;
  height: number;
  perFrame: number;
  ms: number;
}): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const world = window.__studioViewport?.playWorld;
    const crates = window.__perfCrates;
    if (!world || !crates || crates.length !== args.count) {
      reject(new Error(`no running world, or not ${args.count} crates placed`));
      return;
    }
    const rows = Math.ceil(args.count / args.columns);
    const deltas: number[] = [];
    let next = 0;
    let started = -1;
    let last = -1;
    const tick = (): void => {
      const now = performance.now();
      if (last >= 0) deltas.push(now - last);
      else started = now;
      last = now;
      for (let k = 0; k < args.perFrame; k += 1) {
        const slot = next % args.count;
        next += 1;
        const oldest = crates[slot];
        if (oldest !== undefined) world.destroy(oldest);
        const crate = world.instantiate(args.prefab, {
          transform: {
            position: [
              ((slot % args.columns) - (args.columns - 1) / 2) * args.spacing,
              args.height,
              (Math.floor(slot / args.columns) - (rows - 1) / 2) * args.spacing,
            ],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
        });
        if (crate === null) {
          reject(new Error(`the running world has no prefab ${args.prefab}`));
          return;
        }
        crates[slot] = crate;
      }
      if (now - started < args.ms) requestAnimationFrame(tick);
      else resolve(deltas);
    };
    requestAnimationFrame(tick);
  });
}
