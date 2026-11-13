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
