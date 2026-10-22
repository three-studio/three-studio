import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { showPanel } from '../src/shell/dockApi';
import { watchViewportClose, type WatchedDock } from '../src/shell/viewportClose';
import { useEditorStore } from '../src/state/editorStore';

vi.mock('../src/shell/dockApi', () => ({ showPanel: vi.fn() }));

/*
 * Closing the Viewport during Play stops the game. It is the game's only view,
 * and a game nobody can see that goes on playing its sound is what closing the
 * tab must not leave behind.
 *
 * What counts as a close is the dock's to say, and it says it per mutation: a
 * `remove` took the Viewport out, where a move, a float, a template or a Reset
 * Layout's remount only rearranged it. The fake dock below is what the rule reads
 * of dockview: the two events that bracket a mutation, and which panels are in.
 */

function fakeDock(...initial: string[]) {
  const wills: Array<(event: { kind: string }) => void> = [];
  const dids: Array<(event: { kind: string }) => void> = [];
  const open = new Set(initial);
  const listen = (list: Array<(event: { kind: string }) => void>) => (listener: (event: { kind: string }) => void) => {
    list.push(listener);
    return { dispose: () => void list.splice(list.indexOf(listener), 1) };
  };
  const dock: WatchedDock = {
    onWillMutateLayout: listen(wills),
    onDidMutateLayout: listen(dids),
    getPanel: (id) => (open.has(id) ? { id } : undefined),
    get panels() {
      return [...open].map((id) => ({ id }));
    },
  };
  /** One top-level mutation: the will, the change, the did. */
  const mutate = (kind: string, change: (panels: Set<string>) => void) => {
    for (const listener of [...wills]) listener({ kind });
    change(open);
    for (const listener of [...dids]) listener({ kind });
  };
  return { dock, mutate };
}

const ALL = ['viewport', 'hierarchy', 'inspector', 'project', 'console'];
const playState = () => useEditorStore.getState().playState;
/** What `watchViewportClose` queues: it lands after dockview's own dispatch. */
const microtask = () => new Promise<void>((resolve) => queueMicrotask(resolve));

beforeEach(() => {
  vi.mocked(showPanel).mockClear();
  useEditorStore.getState().play();
});
afterEach(() => {
  useEditorStore.getState().stop();
});

describe('closing the Viewport', () => {
  it('stops the game when a removal takes the Viewport out', () => {
    const { dock, mutate } = fakeDock(...ALL);
    watchViewportClose(dock);
    mutate('remove', (panels) => panels.delete('viewport'));
    expect(playState()).toBe('stopped');
  });

  it('does nothing while stopped', () => {
    useEditorStore.getState().stop();
    const { dock, mutate } = fakeDock(...ALL);
    watchViewportClose(dock);
    expect(() => mutate('remove', (panels) => panels.delete('viewport'))).not.toThrow();
    expect(playState()).toBe('stopped');
    expect(showPanel).not.toHaveBeenCalled();
  });

  it('leaves the game alone when another panel is closed', () => {
    const { dock, mutate } = fakeDock(...ALL);
    watchViewportClose(dock);
    mutate('remove', (panels) => panels.delete('console'));
    expect(playState()).toBe('playing');
  });

  it('leaves the game alone through a move and a float, which keep the Viewport', () => {
    const { dock, mutate } = fakeDock(...ALL);
    watchViewportClose(dock);
    mutate('move', () => {});
    mutate('float', () => {});
    expect(playState()).toBe('playing');
  });
});

describe('a template applied during Play', () => {
  it('leaves everything be when it has a Viewport', async () => {
    const { dock, mutate } = fakeDock(...ALL);
    watchViewportClose(dock);
    mutate('load', (panels) => {
      panels.clear();
      for (const id of ALL) panels.add(id);
    });
    await microtask();
    expect(playState()).toBe('playing');
    expect(showPanel).not.toHaveBeenCalled();
  });

  it('brings the Viewport back when it has none, and the game goes on', async () => {
    const { dock, mutate } = fakeDock(...ALL);
    watchViewportClose(dock);
    mutate('load', (panels) => panels.delete('viewport'));
    // Not from inside dockview's dispatch: a panel added there would be a
    // mutation nested in the load's own announcement.
    expect(showPanel).not.toHaveBeenCalled();
    await microtask();
    expect(playState()).toBe('playing');
    expect(vi.mocked(showPanel).mock.calls).toEqual([['viewport']]);
  });

  it('does nothing when the load left the dock empty: the template could not be read', async () => {
    const { dock, mutate } = fakeDock(...ALL);
    watchViewportClose(dock);
    mutate('load', (panels) => panels.clear());
    await microtask();
    expect(playState()).toBe('playing');
    expect(showPanel).not.toHaveBeenCalled();
  });
});

describe('what is not a close', () => {
  it('leaves the game alone when a clear takes the Viewport', async () => {
    const { dock, mutate } = fakeDock(...ALL);
    watchViewportClose(dock);
    mutate('clear', (panels) => panels.clear());
    await microtask();
    expect(playState()).toBe('playing');
    expect(showPanel).not.toHaveBeenCalled();
  });

  it('stops listening once told to', () => {
    const { dock, mutate } = fakeDock(...ALL);
    const stop = watchViewportClose(dock);
    stop();
    mutate('remove', (panels) => panels.delete('viewport'));
    expect(playState()).toBe('playing');
  });
});
