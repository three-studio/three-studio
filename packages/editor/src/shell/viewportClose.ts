import { commandById } from '../commands/registry';
import { useEditorStore } from '../state/editorStore';
import { showPanel } from './dockApi';

/*
 * Closing the Viewport during Play stops the game.
 *
 * The Viewport is the running game's only view. Closed, it would leave a game
 * nobody can see that goes on playing its sound — so its tab's close button and
 * Window ▸ Viewport stop the game.
 *
 * What counts as a close is the hard part, because the panel goes away in more
 * ways than one and only one of them is a close. A move and a float keep the
 * panel; a Reset Layout remounts the whole dock, and its component with it; a
 * template replaces every panel, the Viewport included, with new ones. Hanging
 * the stop on the component's unmount would stop the game at every Reset Layout
 * and every template, and `onDidRemovePanel` fires for each panel a template
 * takes down. So the rule reads the dock's own account instead: every
 * structural change is one mutation, bracketed by `onWillMutateLayout` and
 * `onDidMutateLayout`, which carry its kind. The Viewport there before and gone
 * after says what happened, whatever path dockview took in between; a remount
 * is no mutation at all, which is exactly what it must mean.
 *
 * Its own module rather than part of `panelFocus`: that one is the dock reacting
 * to the editor's state, and this one is the editor's state reacting to the dock.
 */

const VIEWPORT = 'viewport';

/** The part of the dock the rule reads: structural, so a test drives it with two emitters and a set. */
export interface WatchedDock {
  readonly onWillMutateLayout: (listener: (event: { kind: string }) => void) => { dispose(): void };
  readonly onDidMutateLayout: (listener: (event: { kind: string }) => void) => { dispose(): void };
  getPanel(id: string): unknown;
  readonly panels: readonly unknown[];
}

/**
 * Watches one dock for as long as it lives. Returns the way to stop watching.
 *
 * Once per dock: a Reset Layout disposes the dock and its emitters with it, and
 * the new dock is watched by a call of its own.
 */
export function watchViewportClose(dock: WatchedDock): () => void {
  const isOpen = () => dock.getPanel(VIEWPORT) !== undefined;
  let openBefore = false;

  // Nested mutations join the outermost, so this sees one will and one did for
  // a whole gesture, however many removals and additions it is made of.
  const will = dock.onWillMutateLayout(() => {
    openBefore = isOpen();
  });

  const did = dock.onDidMutateLayout((event) => {
    const closed = openBefore && !isOpen();
    openBefore = false;
    if (!closed || useEditorStore.getState().playState === 'stopped') return;

    // Its tab's close button or Window ▸ Viewport: closed.
    if (event.kind === 'remove') {
      commandById('stop').run();
      return;
    }

    /*
     * A template without a Viewport, applied while the game runs: the person
     * asked for an arrangement, not for the game to end, so the game goes on and
     * its view comes back. Queued, so that it lands after dockview's own
     * dispatch rather than as a mutation nested in the load's announcement.
     *
     * A load that left the dock empty is not that: it is a template dockview
     * could not read, which reverts what it built, and the caller puts the
     * default back. Anything else — a clear, say — is not a close either.
     */
    if (event.kind === 'load' && dock.panels.length > 0) {
      queueMicrotask(() => {
        if (useEditorStore.getState().playState !== 'stopped' && !isOpen()) showPanel(VIEWPORT);
      });
    }
  });

  return () => {
    will.dispose();
    did.dispose();
  };
}
