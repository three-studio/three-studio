import {
  PROJECT_FORMAT_VERSION,
  createBuildProfiles,
  createEmptyScene,
  createMeshEntity,
  createPhysicsSettings,
  createRenderingSettings,
  type ProjectFile,
} from '@three-studio/core';
import type { WebGPURenderer } from 'three/webgpu';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prefabWith } from '../../core/test/fixtures';
import { useAssetStore } from '../src/state/assetStore';
import { useDocumentStore } from '../src/state/documentStore';
import { useEditorStore } from '../src/state/editorStore';
import { usePrefabModeStore } from '../src/state/prefabModeStore';
import { useProjectStore } from '../src/state/projectStore';
import { useScriptStore } from '../src/state/scriptStore';
import { useToastStore } from '../src/state/toastStore';
import { useViewportStore } from '../src/state/viewportStore';
import { PlaySession, type PlayHost } from '../src/viewport/PlaySession';
import type { Presentation } from '../src/viewport/Presentation';

/*
 * What pressing Play does, and what Stop undoes — above all when the game never
 * starts. The Viewport is the only view of the game, so a failed Play that took
 * it over, or that was said only over a game that never came, left the person
 * looking at the scene with nothing to say what had happened.
 */

const SCENE_ID = 'window-scene';
const PREFAB_ID = 'prefab-under-test';

const project: ProjectFile = {
  version: PROJECT_FORMAT_VERSION,
  name: 'Session',
  engineVersion: '0.1.0',
  startScene: SCENE_ID,
  settings: {
    loadingScene: null,
    rendering: createRenderingSettings(),
    physics: createPhysicsSettings(),
    build: createBuildProfiles('Session'),
  },
};

const realSavePrefab = useAssetStore.getState().savePrefab;
const realBuild = useScriptStore.getState().build;

const toasts = () => useToastStore.getState().toasts;
const playState = () => useEditorStore.getState().playState;
const play = () => useEditorStore.getState().play();
const stop = () => useEditorStore.getState().stop();
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A start goes through a few awaits, none of which waits on anything real here. */
async function until(condition: () => boolean, what: string): Promise<void> {
  for (let turn = 0; turn < 200; turn += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

/** What the session tells the viewport, in order. */
interface StubHost extends PlayHost {
  readonly calls: string[];
}

function stubHost(): StubHost {
  const calls: string[] = [];
  return {
    calls,
    // `null` is what `EngineOptions.renderer` allows for: a scene's analytic sky
    // is skipped without a device.
    renderer: null as unknown as WebGPURenderer,
    gameView: { canvas: new EventTarget(), visible: true, width: 16, height: 9 } as unknown as Presentation,
    rendering: createRenderingSettings(),
    onPlayStarted: () => calls.push('started'),
    onPlayStopped: () => calls.push('stopped'),
  };
}

let session: PlaySession | null = null;

/** A session watching the transport, as the viewport builds one. */
function watching(): StubHost {
  const host = stubHost();
  session = new PlaySession(host);
  session.watch();
  return host;
}

/** Every compile fails, with these errors where `scriptStore.build` leaves them. */
function compilesFail(errors: string[]): void {
  useScriptStore.setState({
    build: async () => {
      useScriptStore.setState({ errors });
      return false;
    },
  });
}

/** Every compile waits: `finish(n, …)` ends the n-th one asked for. */
function compilesHeld(): { finish: (index: number, compiled: boolean, errors?: string[]) => Promise<void> } {
  const pending: ((compiled: boolean) => void)[] = [];
  useScriptStore.setState({ build: () => new Promise<boolean>((resolve) => pending.push(resolve)) });
  return {
    finish: async (index, compiled, errors = []) => {
      useScriptStore.setState({ errors });
      pending[index]!(compiled);
      await settle();
    },
  };
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  usePrefabModeStore.setState({ stack: [] });
  stop();
  useDocumentStore.getState().replaceScene(createEmptyScene());
  useProjectStore.setState({
    project,
    sceneId: SCENE_ID,
    scenes: [{ id: SCENE_ID, name: 'Level One', path: 'scenes/level-one.scene.json', shadowedBy: null }],
  });
  const root = createMeshEntity('box');
  useAssetStore.setState({
    prefabs: { [PREFAB_ID]: prefabWith('Crate', [root], root.entity.id) },
    savePrefab: async () => {},
  });
  useViewportStore.setState({ rendererError: null, playWarnings: [] });
  useToastStore.getState().clear();
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  session?.dispose();
  session = null;
  useAssetStore.setState({ savePrefab: realSavePrefab });
  useScriptStore.setState({ build: realBuild, errors: [] });
  vi.restoreAllMocks();
});

describe('a Play that fails', () => {
  it('says a compile failure in a toast, and gives the view back', async () => {
    compilesFail(['Player.ts(3,1): error TS1005', 'Enemy.ts(9,4): error TS2304']);
    const host = watching();

    play();
    await until(() => playState() === 'stopped', 'the stop');

    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]).toMatchObject({
      kind: 'error',
      title: 'Scripts did not compile',
      description: '2 errors, listed in the Console.',
    });
    expect(toasts()[0]!.actions).toEqual([
      { label: 'Show Console', primary: true, onClick: expect.any(Function) },
    ]);
    // Neither of the two places that used to say it: the whole view, or the
    // problems box over a game that never came.
    expect(useViewportStore.getState().rendererError).toBeNull();
    expect(useViewportStore.getState().playWarnings).toEqual([]);
    expect(host.calls).toEqual(['stopped']);
  });

  it('counts one error as one', async () => {
    compilesFail(['Player.ts(3,1): error TS1005']);
    watching();

    play();
    await until(() => playState() === 'stopped', 'the stop');

    expect(toasts()[0]!.description).toBe('1 error, listed in the Console.');
  });

  it('says a start that throws, and leaves the stack to the Console', async () => {
    // Leaving Prefab Mode saves, and it is the first thing a start does: a save
    // that fails is a start that throws before anything else has run.
    const cause = new Error('the prefab could not be saved');
    useAssetStore.setState({ savePrefab: () => Promise.reject(cause) });
    await usePrefabModeStore.getState().open(PREFAB_ID);
    compilesFail([]);
    const host = watching();

    play();
    await until(() => playState() === 'stopped', 'the stop');

    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]).toMatchObject({
      kind: 'error',
      title: 'The game could not start',
      description: 'Error: the prefab could not be saved',
    });
    expect(toasts()[0]!.actions).toEqual([
      { label: 'Show Console', primary: true, onClick: expect.any(Function) },
    ]);
    expect(consoleError).toHaveBeenCalledWith('[play] The game could not start:', cause);
    expect(useViewportStore.getState().rendererError).toBeNull();
    expect(useViewportStore.getState().playWarnings).toEqual([]);
    expect(host.calls).toEqual(['stopped']);
  });

  it('keeps one failure toast, and the next press takes it away at once', async () => {
    compilesFail(['Player.ts(3,1): error TS1005']);
    watching();
    play();
    await until(() => playState() === 'stopped', 'the first stop');
    play();
    await until(() => playState() === 'stopped', 'the second stop');

    expect(toasts()).toHaveLength(1);

    compilesHeld();
    play();

    // Before anything is awaited: the toast is about a Play this press replaces.
    expect(toasts()).toEqual([]);
  });

  it('says nothing for a start nobody waits for any more', async () => {
    const compiles = compilesHeld();
    watching();

    play();
    stop();
    await compiles.finish(0, false, ['Player.ts(3,1): error TS1005']);

    expect(playState()).toBe('stopped');
    expect(toasts()).toEqual([]);
    expect(useViewportStore.getState().playWarnings).toEqual([]);
  });

  it('leaves the Play pressed last to say how it ended', async () => {
    // Play, Stop, Play, all during the first compile: that compile failing is
    // about a Play that has been replaced, and must neither stop the second nor
    // say anything.
    const compiles = compilesHeld();
    watching();

    play();
    stop();
    play();
    await compiles.finish(0, false, ['Player.ts(3,1): error TS1005']);

    expect(playState()).toBe('playing');
    expect(toasts()).toEqual([]);

    await compiles.finish(1, false, ['Player.ts(3,1): error TS1005']);
    await until(() => playState() === 'stopped', 'the stop');

    expect(toasts()).toHaveLength(1);
  });

  it('offers the Console, where the details are', async () => {
    compilesFail(['Player.ts(3,1): error TS1005']);
    watching();
    play();
    await until(() => playState() === 'stopped', 'the stop');
    const before = useEditorStore.getState().consoleRequests;

    toasts()[0]!.actions![0]!.onClick();

    expect(useEditorStore.getState().consoleRequests).toBe(before + 1);
  });
});
