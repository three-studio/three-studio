import {
  LAUNCH_SNAPSHOT_VERSION,
  PROJECT_FORMAT_VERSION,
  createBuildProfiles,
  createEmptyScene,
  createEntity,
  createMaterial,
  createMeshEntity,
  createPhysicsSettings,
  createPrefabInstance,
  createRenderingSettings,
  createStarterScene,
  type DeviceServerStatus,
  type LaunchSnapshot,
  type PrefabDoc,
  type ProjectFile,
} from '@three-studio/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prefabWith } from '../../core/test/fixtures';
import { addEntity } from '../src/commands/sceneCommands';
import {
  LIVE_RELOAD_PAUSE_MS,
  createLiveReload,
  sameLaunchInputs,
  watchLiveReload,
  type LiveReloadEnv,
} from '../src/shell/liveReload';
import { useAssetStore } from '../src/state/assetStore';
import { useDeviceStore } from '../src/state/deviceStore';
import { useDocumentStore } from '../src/state/documentStore';
import { useEditorStore } from '../src/state/editorStore';
import { usePrefabModeStore } from '../src/state/prefabModeStore';
import { useProjectStore } from '../src/state/projectStore';
import { launchSnapshot } from '../src/viewport/PlaySession';

/*
 * Live reload: every device relaunched a second after the last change, from
 * the window whose launch is current — and all the moments it does nothing.
 * A relaunch restarts every phone, so the one sent for nothing is the
 * failure worth pinning: a gesture under way, Play, a screen that already
 * shows what was launched.
 */

function snapshot(): LaunchSnapshot {
  return {
    version: LAUNCH_SNAPSHOT_VERSION,
    entry: { id: 'scene-1', name: 'Level 1', scene: createStarterScene() },
    materials: { stone: createMaterial('#808080') },
    prefabs: {},
    rendering: createRenderingSettings(),
    physics: createPhysicsSettings(),
    loadingScene: null,
  };
}

/** The same launch, its first entity moved along x. */
function moved(from: LaunchSnapshot, x: number): LaunchSnapshot {
  const next = structuredClone(from);
  const [id] = Object.keys(next.entry.scene.entities);
  next.entry.scene.entities[id!]!.transform.position[0] = x;
  return next;
}

/** An object with its keys the other way round, as another path to the same state could build it. */
function reversed<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).reverse()) as T;
}

/**
 * The window, as live reload sees it: each answer a field the test sets. A
 * relaunch settles only when the test says, and then what it sent is what
 * was launched — as a status naming it would make it.
 */
function harness(launched: LaunchSnapshot = snapshot()) {
  const state = {
    active: true,
    held: false,
    playing: false,
    screen: moved(launched, 5),
    launched,
    relaunched: [] as LaunchSnapshot[],
    pending: [] as (() => void)[],
  };
  const env: LiveReloadEnv = {
    active: () => state.active,
    held: () => state.held,
    playing: () => state.playing,
    read: () => state.screen,
    launched: () => state.launched,
    relaunch: (sent) => {
      state.relaunched.push(sent);
      return new Promise<void>((resolve) => {
        state.pending.push(() => {
          state.launched = sent;
          resolve();
        });
      });
    },
  };
  return { state, env };
}

/** Lets a settled relaunch's callbacks run. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the pause', () => {
  it('relaunches once, a second after a change, with what is on screen then', () => {
    const { state, env } = harness();
    const live = createLiveReload(env);

    live.poke();
    vi.advanceTimersByTime(LIVE_RELOAD_PAUSE_MS - 1);
    expect(state.relaunched).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(state.relaunched).toHaveLength(1);
    expect(state.relaunched[0]).toBe(state.screen);
  });

  it('starts again with each change, and relaunches once, after the last', () => {
    const { state, env } = harness();
    const live = createLiveReload(env);

    live.poke();
    vi.advanceTimersByTime(600);
    live.poke();
    vi.advanceTimersByTime(600);
    live.poke();
    vi.advanceTimersByTime(999);
    expect(state.relaunched).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(state.relaunched).toHaveLength(1);
  });
});

describe('a pause that ends and does nothing', () => {
  it('while live reload is not active', () => {
    const { state, env } = harness();
    state.active = false;
    const live = createLiveReload(env);

    live.poke();
    vi.advanceTimersByTime(5_000);

    expect(state.relaunched).toEqual([]);
  });

  it('during a gesture, whose release starts the pause again', () => {
    const { state, env } = harness();
    const live = createLiveReload(env);

    state.held = true;
    live.poke();
    vi.advanceTimersByTime(3_000);
    expect(state.relaunched).toEqual([]);

    state.held = false;
    live.poke();
    vi.advanceTimersByTime(LIVE_RELOAD_PAUSE_MS - 1);
    expect(state.relaunched).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(state.relaunched).toHaveLength(1);
  });

  it('during Play, whose Stop starts the pause again', () => {
    const { state, env } = harness();
    const live = createLiveReload(env);

    state.playing = true;
    live.poke();
    vi.advanceTimersByTime(3_000);
    expect(state.relaunched).toEqual([]);

    state.playing = false;
    live.poke();
    vi.advanceTimersByTime(LIVE_RELOAD_PAUSE_MS);
    expect(state.relaunched).toHaveLength(1);
  });

  it('when the screen holds what was launched, under new objects', () => {
    const { state, env } = harness();
    state.screen = structuredClone(state.launched);
    const live = createLiveReload(env);

    live.poke();
    vi.advanceTimersByTime(5_000);

    expect(state.relaunched).toEqual([]);
  });
});

describe('one relaunch at a time', () => {
  it('leaves a check for when the relaunch in flight settles, which relaunches at once', async () => {
    const { state, env } = harness();
    const live = createLiveReload(env);
    live.poke();
    vi.advanceTimersByTime(LIVE_RELOAD_PAUSE_MS);
    const later = moved(state.launched, 9);
    state.screen = later;

    live.poke();
    vi.advanceTimersByTime(LIVE_RELOAD_PAUSE_MS);
    expect(state.relaunched).toHaveLength(1);

    state.pending.shift()!();
    await flush();
    expect(state.relaunched).toHaveLength(2);
    expect(state.relaunched[1]).toBe(later);
  });

  it('relaunches nothing then, when the screen is back to what the first one sent', async () => {
    const { state, env } = harness();
    const live = createLiveReload(env);
    live.poke();
    vi.advanceTimersByTime(LIVE_RELOAD_PAUSE_MS);
    const first = state.screen;
    state.screen = moved(first, 9);
    live.poke();
    vi.advanceTimersByTime(LIVE_RELOAD_PAUSE_MS);

    state.screen = structuredClone(first);
    state.pending.shift()!();
    await flush();

    expect(state.relaunched).toEqual([first]);
  });
});

describe('disposing of it', () => {
  it('ends the pause under way', () => {
    const { state, env } = harness();
    const live = createLiveReload(env);

    live.poke();
    live.dispose();
    vi.advanceTimersByTime(5_000);

    expect(state.relaunched).toEqual([]);
  });

  it('checks nothing when a relaunch in flight settles afterwards', async () => {
    const { state, env } = harness();
    const live = createLiveReload(env);
    live.poke();
    vi.advanceTimersByTime(LIVE_RELOAD_PAUSE_MS);
    state.screen = moved(state.screen, 9);
    live.poke();
    vi.advanceTimersByTime(LIVE_RELOAD_PAUSE_MS);

    live.dispose();
    state.pending.shift()!();
    await flush();

    expect(state.relaunched).toHaveLength(1);
  });
});

describe('the same launch', () => {
  it('is a snapshot and itself, a copy of it, and the same data in another key order', () => {
    const a = snapshot();
    const keysTurned = {
      ...a,
      rendering: reversed(a.rendering),
      entry: { ...a.entry, scene: { ...a.entry.scene, entities: reversed(a.entry.scene.entities) } },
    };

    expect(sameLaunchInputs(a, a)).toBe(true);
    expect(sameLaunchInputs(a, structuredClone(a))).toBe(true);
    expect(sameLaunchInputs(a, keysTurned)).toBe(true);
  });

  it('is not a moved entity, a new material, another gravity, or the scene renamed', () => {
    const a = snapshot();
    const withMaterial = { ...a, materials: { ...a.materials, sand: createMaterial('#c2b280') } };
    const lighter = { ...a, physics: { ...a.physics, gravity: [0, -1.62, 0] as [number, number, number] } };
    const renamed = { ...a, entry: { ...a.entry, name: 'Level 2' } };

    expect(sameLaunchInputs(a, moved(a, 5))).toBe(false);
    expect(sameLaunchInputs(a, withMaterial)).toBe(false);
    expect(sameLaunchInputs(a, lighter)).toBe(false);
    expect(sameLaunchInputs(a, renamed)).toBe(false);
  });
});

/*
 * ------------------------------------------------- watching a real window
 *
 * The stores as the editor has them, the bridge answering every launch as
 * the server would — the new launch current, its status heard — and a bare
 * `EventTarget` for the window, so a gesture is an event a test dispatches.
 */

const SCENE_ID = 'window-scene';
const PREFAB_ID = 'prefab-under-test';
const MATERIAL_ID = 'material-under-test';

const project: ProjectFile = {
  version: PROJECT_FORMAT_VERSION,
  name: 'Live',
  engineVersion: '0.1.0',
  startScene: SCENE_ID,
  settings: {
    loadingScene: null,
    rendering: createRenderingSettings(),
    physics: createPhysicsSettings(),
    build: createBuildProfiles('Live'),
  },
};

function running(launch: string, overrides: Partial<DeviceServerStatus> = {}): DeviceServerStatus {
  return {
    state: 'running',
    transport: 'http',
    port: 7700,
    requestedPort: 7700,
    portHolder: null,
    urls: [],
    selectedUrl: null,
    launch: { id: launch, at: 1, sceneName: 'Level One' },
    reachedFromNetwork: false,
    address: null,
    liveReload: true,
    devices: [],
    certificate: null,
    ...overrides,
  };
}

const doc = () => useDocumentStore.getState();
const realSavePrefab = useAssetStore.getState().savePrefab;

/** What each relaunch sent, in order. */
let sent: LaunchSnapshot[] = [];
const stops: (() => void)[] = [];
let cube = '';

/** Every relaunch's callbacks, run. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

function moveCube(x: number): void {
  doc().mutate('Move Cube', (scene) => {
    scene.entities[cube]!.transform.position[0] = x;
  });
}

/**
 * Starts watching, with live reload on and the current launch this window's,
 * made from what is on screen now.
 */
function watch(target: EventTarget = new EventTarget()): EventTarget {
  useDeviceStore.setState({
    status: running('L1'),
    ownLaunch: { id: 'L1', snapshot: launchSnapshot() },
    liveReloadRefused: null,
  });
  stops.push(watchLiveReload(target));
  return target;
}

const pointer = (type: string, pointerId = 1): Event => Object.assign(new Event(type), { pointerId });

describe('watching the window', () => {
  beforeEach(async () => {
    sent = [];
    vi.stubGlobal('window', {
      studio: {
        devices: {
          launch: async (snapshot: LaunchSnapshot) => {
            sent.push(snapshot);
            // As the server's next status would say: this launch is current.
            const status = running(`L${sent.length + 1}`);
            useDeviceStore.setState({ status });
            return status;
          },
        },
      },
    });
    await usePrefabModeStore.getState().exit();
    usePrefabModeStore.setState({ stack: [] });
    useEditorStore.getState().stop();
    useProjectStore.setState({
      project,
      sceneId: SCENE_ID,
      scenes: [{ id: SCENE_ID, name: 'Level One', path: 'scenes/level-one.scene.json', shadowedBy: null }],
    });
    const root = createMeshEntity('box');
    root.entity.name = 'Crate';
    useAssetStore.setState({
      materials: { [MATERIAL_ID]: createMaterial() },
      prefabs: { [PREFAB_ID]: prefabWith('Crate', [root], root.entity.id) },
      // As the store's own does once the file is written: the table takes it.
      savePrefab: async (assetId: string, prefab: PrefabDoc) => {
        useAssetStore.setState((state) => ({ prefabs: { ...state.prefabs, [assetId]: prefab } }));
      },
    });
    doc().replaceScene(createEmptyScene());
    cube = addEntity(createMeshEntity('box'));
    addEntity(createEntity('Crate', [createPrefabInstance(PREFAB_ID)]));
    useEditorStore.getState().setSelection([]);
  });

  afterEach(async () => {
    for (const stop of stops.splice(0)) stop();
    await usePrefabModeStore.getState().exit();
    useAssetStore.setState({ savePrefab: realSavePrefab });
    vi.unstubAllGlobals();
  });

  describe('relaunches, a second after', () => {
    it('an entity moved', async () => {
      watch();

      moveCube(4);
      vi.advanceTimersByTime(LIVE_RELOAD_PAUSE_MS - 1);
      expect(sent).toEqual([]);
      vi.advanceTimersByTime(1);
      await settle();

      expect(sent).toHaveLength(1);
      expect(sent[0]!.entry.scene.entities[cube]!.transform.position[0]).toBe(4);
      expect(useDeviceStore.getState().ownLaunch?.id).toBe('L2');
    });

    it('an undo', () => {
      moveCube(4);
      watch();

      doc().undo();
      vi.advanceTimersByTime(LIVE_RELOAD_PAUSE_MS);

      expect(sent).toHaveLength(1);
      expect(sent[0]!.entry.scene.entities[cube]!.transform.position[0]).toBe(0);
    });

    it('a material changed', () => {
      watch();

      useAssetStore.setState((state) => ({
        materials: { ...state.materials, [MATERIAL_ID]: createMaterial('#ff0000') },
      }));
      vi.advanceTimersByTime(LIVE_RELOAD_PAUSE_MS);

      expect(sent).toHaveLength(1);
    });

    it('the project adopted again with another gravity', () => {
      watch();

      useProjectStore.getState().adoptProject({
        ...project,
        settings: {
          ...project.settings,
          physics: { ...project.settings.physics, gravity: [0, -1.62, 0] },
        },
      });
      vi.advanceTimersByTime(LIVE_RELOAD_PAUSE_MS);

      expect(sent).toHaveLength(1);
      expect(sent[0]!.physics.gravity).toEqual([0, -1.62, 0]);
    });
  });

  describe('relaunches nothing after', () => {
    it.each([
      ['a selection', () => useEditorStore.getState().setSelection([cube])],
      ['a save', () => doc().markClean()],
      [
        'the scene put back as a copy, as Stop puts it back',
        () => doc().replaceScene(structuredClone(doc().scene), { keepHistory: true }),
      ],
      [
        'the asset tables made anew, as a refresh makes them',
        () =>
          useAssetStore.setState((state) => ({
            materials: structuredClone(state.materials),
            prefabs: structuredClone(state.prefabs),
          })),
      ],
      [
        'the project adopted again unchanged',
        () => useProjectStore.getState().adoptProject(structuredClone(project)),
      ],
    ])('%s', (_what, change) => {
      watch();

      change();
      vi.advanceTimersByTime(5_000);

      expect(sent).toEqual([]);
    });

    it('a prefab opened, then left without an edit', async () => {
      watch();

      await usePrefabModeStore.getState().open(PREFAB_ID);
      vi.advanceTimersByTime(5_000);
      expect(sent).toEqual([]);

      await usePrefabModeStore.getState().exit();
      vi.advanceTimersByTime(5_000);
      expect(sent).toEqual([]);
    });
  });

  it('relaunches an edit made in Prefab Mode, the prefab composed, the scene the one it was opened from', async () => {
    const scene = doc().scene;
    watch();

    await usePrefabModeStore.getState().open(PREFAB_ID);
    const inside = addEntity(createMeshEntity('sphere'));
    vi.advanceTimersByTime(LIVE_RELOAD_PAUSE_MS);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.entry.scene).toBe(scene);
    expect(sent[0]!.prefabs[PREFAB_ID]!.entities[inside]).toBeDefined();
  });

  describe('holds while', () => {
    it('a pointer is down, and relaunches a second after it is let go', () => {
      const target = watch();

      target.dispatchEvent(pointer('pointerdown'));
      moveCube(4);
      vi.advanceTimersByTime(3_000);
      expect(sent).toEqual([]);

      target.dispatchEvent(pointer('pointerup'));
      vi.advanceTimersByTime(LIVE_RELOAD_PAUSE_MS - 1);
      expect(sent).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(sent).toHaveLength(1);
    });

    it('two pointers are down, until the last is let go', () => {
      const target = watch();

      target.dispatchEvent(pointer('pointerdown', 1));
      target.dispatchEvent(pointer('pointerdown', 2));
      moveCube(4);
      target.dispatchEvent(pointer('pointercancel', 1));
      vi.advanceTimersByTime(3_000);
      expect(sent).toEqual([]);

      target.dispatchEvent(pointer('pointerup', 2));
      vi.advanceTimersByTime(LIVE_RELOAD_PAUSE_MS);
      expect(sent).toHaveLength(1);
    });

    it('something is dragged, and relaunches a second after the drop', () => {
      const target = watch();

      target.dispatchEvent(new Event('dragstart'));
      moveCube(4);
      vi.advanceTimersByTime(3_000);
      expect(sent).toEqual([]);

      target.dispatchEvent(new Event('drop'));
      vi.advanceTimersByTime(LIVE_RELOAD_PAUSE_MS);
      expect(sent).toHaveLength(1);
    });

    it('a pointer is down, until the window loses the focus', () => {
      // A release outside the window is not always seen.
      const target = watch();

      target.dispatchEvent(pointer('pointerdown'));
      moveCube(4);
      vi.advanceTimersByTime(3_000);
      expect(sent).toEqual([]);

      target.dispatchEvent(new Event('blur'));
      vi.advanceTimersByTime(LIVE_RELOAD_PAUSE_MS);
      expect(sent).toHaveLength(1);
    });
  });

  describe('Play', () => {
    it('holds a change made during it, until a second after Stop', () => {
      watch();

      useEditorStore.getState().play();
      moveCube(4);
      vi.advanceTimersByTime(3_000);
      expect(sent).toEqual([]);

      useEditorStore.getState().stop();
      vi.advanceTimersByTime(LIVE_RELOAD_PAUSE_MS - 1);
      expect(sent).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(sent).toHaveLength(1);
    });

    it('holds a change made just before it, until Stop', () => {
      watch();

      moveCube(4);
      vi.advanceTimersByTime(500);
      useEditorStore.getState().play();
      vi.advanceTimersByTime(3_000);
      expect(sent).toEqual([]);

      useEditorStore.getState().stop();
      vi.advanceTimersByTime(LIVE_RELOAD_PAUSE_MS);
      expect(sent).toHaveLength(1);
    });
  });

  describe('relaunches nothing while it is not active', () => {
    it.each([
      ['live reload off', running('L1', { liveReload: false })],
      ['the devices on another window’s launch', running('L9')],
      ['the server stopped', running('L1', { state: 'stopped', launch: null })],
    ])('%s', (_what, status) => {
      watch();
      useDeviceStore.setState({ status });

      moveCube(4);
      vi.advanceTimersByTime(5_000);

      expect(sent).toEqual([]);
    });
  });

  it('relaunches a second after being turned on, when the screen already differs', () => {
    watch();
    useDeviceStore.setState({ status: running('L1', { liveReload: false }) });
    moveCube(4);
    vi.advanceTimersByTime(3_000);
    expect(sent).toEqual([]);

    useDeviceStore.setState({ status: running('L1') });
    vi.advanceTimersByTime(LIVE_RELOAD_PAUSE_MS - 1);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sent).toHaveLength(1);
  });

  it('lets go of every listener and every store once stopped', () => {
    const target = new EventTarget();
    const added = vi.spyOn(target, 'addEventListener');
    const removed = vi.spyOn(target, 'removeEventListener');
    watch(target);

    stops.pop()!();
    moveCube(4);
    vi.advanceTimersByTime(5_000);

    expect(sent).toEqual([]);
    const listeners = (calls: unknown[][]) => calls.map(([type, listener]) => [type, listener]);
    expect(added.mock.calls.length).toBeGreaterThan(0);
    expect(listeners(removed.mock.calls)).toEqual(listeners(added.mock.calls));
  });
});
