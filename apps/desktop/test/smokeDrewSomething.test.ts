import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { useViewportStore } from '@three-studio/editor/state/viewportStore';
import { afterEach, describe, expect, it } from 'vitest';

/*
 * CI's boot check asks the editor's viewport store whether the viewport drew,
 * through `scripts/smoke-drew-something.js` — a script that is only text here,
 * run inside the page by the smoke harness. Neither the typecheck nor a test
 * ever read it: when the store's `error` became `rendererError`, every local
 * check stayed green, and CI called a renderer that drew six calls on WebGL2
 * `renderer-failed`, since `undefined !== null`.
 *
 * So the script runs here against the real store, as the page would run it:
 * `window.__studioStores.viewport` is the store, and the canvas is the one
 * `document.querySelector` finds. Its waits are cut short, so that a verdict
 * reached only after thirty seconds of polling comes at once.
 */

const SCRIPT = readFileSync(new URL('../scripts/smoke-drew-something.js', import.meta.url), 'utf8');

interface Verdict {
  verdict: string;
  drawCalls: number;
}

async function verdictOf(canvas: { width: number; height: number } | null = { width: 706, height: 658 }): Promise<Verdict> {
  const sandbox = {
    window: { __studioStores: { viewport: useViewportStore } },
    document: { querySelector: () => canvas },
    setTimeout: (callback: () => void) => setImmediate(callback),
  };
  return (await runInNewContext(SCRIPT, sandbox)) as Verdict;
}

const initial = useViewportStore.getState();

afterEach(() => {
  useViewportStore.setState(initial, true);
});

describe("CI's verdict on the viewport", () => {
  it('is ok for a renderer that draws', async () => {
    useViewportStore.setState({ backend: 'webgl', rendererError: null, drawCalls: 6, triangles: 45, fps: 7 });
    expect(await verdictOf()).toMatchObject({ verdict: 'ok', drawCalls: 6 });
  });

  it('is renderer-failed for a renderer that failed to start', async () => {
    useViewportStore.setState({ rendererError: 'No available adapters.', drawCalls: 0 });
    expect((await verdictOf()).verdict).toBe('renderer-failed');
  });

  it('is drew-nothing for a renderer that ran and drew nothing', async () => {
    useViewportStore.setState({ rendererError: null, drawCalls: 0 });
    expect((await verdictOf()).verdict).toBe('drew-nothing');
  });
});
