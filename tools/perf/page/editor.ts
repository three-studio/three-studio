/*
 * Page functions for the editor's window: run there by `runInPage`, so each is
 * whole in itself — see `launch/cdp.ts`. They reach the editor through the
 * handles `devtools.ts` declares on `window`.
 */

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

/** Presses Play the way the toolbar does, and resolves once the game is on screen: how long that took, in ms. */
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
      if (stores.viewport.getState().gameShown) resolve({ gameShownMs: performance.now() - pressed });
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
