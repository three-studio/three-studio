import {
  LAUNCH_SNAPSHOT_VERSION,
  createMaterial,
  createPhysicsSettings,
  createRenderingSettings,
  createStarterScene,
  type LaunchSnapshot,
} from '@three-studio/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LIVE_RELOAD_PAUSE_MS,
  createLiveReload,
  sameLaunchInputs,
  type LiveReloadEnv,
} from '../src/shell/liveReload';

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
