/*
 * `STUDIO_SMOKE_SETUP` for the second half of the CI check: did the viewport
 * actually draw?
 *
 * A blank window and a working window look identical in a build log, and they
 * also look identical to the harness's own probe: it reports the DOM, and the
 * whole editor chrome is React. Every panel, menu and label paints perfectly
 * with a renderer that never ran. So the question is asked of the renderer:
 * `viewportStore` carries what `WebGPURenderer.info.render` reported on the last
 * stats tick, and draw calls above zero is the one number that cannot be true of
 * a window that drew nothing.
 *
 * **It returns a verdict; it does not throw.** A setup that throws makes
 * `runSmokeTest` give up before `capturePage`, so the one run whose picture is
 * worth having would be the one run with no picture. The caller reads the
 * verdict out of the log — see `.github/workflows/ci.yml`.
 */
(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // The harness allows three seconds before running this, which is generous on
  // a machine with a GPU and not obviously generous on one without. Waiting for
  // the stores rather than assuming them turns "React was still mounting" from
  // a TypeError about `undefined` into the wait it actually is.
  for (let i = 0; i < 40 && window.__studioStores === undefined; i += 1) await wait(250);
  if (window.__studioStores === undefined) return { verdict: 'editor-never-mounted' };
  const viewport = window.__studioStores.viewport;

  /*
   * Up to thirty seconds, because the stats are published on an interval and
   * SwiftShader is not fast: a first frame that takes seconds is normal on a
   * runner with no GPU and would be a failure on anything else. Polling stops at
   * the first sign of either answer, so a healthy machine spends ~1 tick here.
   */
  let stats = viewport.getState();
  for (let i = 0; i < 60 && stats.drawCalls === 0 && stats.error === null; i += 1) {
    await wait(500);
    stats = viewport.getState();
  }

  // The same canvas the harness's own probe measures: the viewport's is the
  // first in the editor document.
  const canvas = document.querySelector('canvas');
  const size = canvas ? { width: canvas.width, height: canvas.height } : null;

  const verdict =
    stats.error !== null
      ? 'renderer-failed'
      : size === null || size.width === 0 || size.height === 0
        ? 'canvas-has-no-size'
        : stats.drawCalls === 0
          ? 'drew-nothing'
          : 'ok';

  return {
    verdict,
    error: stats.error,
    backend: stats.backend,
    fps: stats.fps,
    drawCalls: stats.drawCalls,
    triangles: stats.triangles,
    canvas: size,
  };
})();
