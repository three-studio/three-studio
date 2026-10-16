import type { LaunchSnapshot } from '@three-studio/core';
import { relaunchOnDevices } from '../commands/deviceCommands';
import { useAssetStore } from '../state/assetStore';
import { liveReloadState, useDeviceStore } from '../state/deviceStore';
import { useDocumentStore } from '../state/documentStore';
import { useEditorStore } from '../state/editorStore';
import { usePrefabModeStore } from '../state/prefabModeStore';
import { useProjectStore } from '../state/projectStore';
import { launchSnapshot } from '../viewport/PlaySession';

/*
 * Live reload: every device relaunched a second after the last change made in
 * this window, while the server's current launch is this window's.
 *
 * A relaunch restarts every phone on the link, so most of what is here is
 * about when not to send one: while a gesture is under way, during Play, and
 * whenever what a launch would send is what was sent last.
 */

/** How long editing has to pause before the devices relaunch. */
export const LIVE_RELOAD_PAUSE_MS = 1_000;

/**
 * Whether two launches would send the same thing.
 *
 * By content, not by reference: the stores hand out new objects holding
 * nothing new, and often — a refresh of the asset store makes every material
 * and prefab anew, Stop puts back a clone of the scene, opening a prefab and
 * leaving it rebuilds the scene, a project adopted again is a new object. Each
 * would restart every phone for nothing, Stop after every Play above all.
 *
 * Cheap where it is common: an edit keeps every branch it did not touch, so
 * equal references end the walk at once, and the full walk comes only after a
 * Stop or a refresh, once per pause.
 */
export function sameLaunchInputs(a: LaunchSnapshot, b: LaunchSnapshot): boolean {
  return (
    a.version === b.version &&
    a.entry.id === b.entry.id &&
    a.entry.name === b.entry.name &&
    a.loadingScene === b.loadingScene &&
    sameData(a.entry.scene, b.entry.scene) &&
    sameData(a.materials, b.materials) &&
    sameData(a.prefabs, b.prefabs) &&
    sameData(a.rendering, b.rendering) &&
    sameData(a.physics, b.physics)
  );
}

/**
 * Plain data compared by content, whatever the order of its keys — two paths
 * to the same state may build an object in two orders. Stops wherever two
 * references are equal.
 */
function sameData(a: unknown, b: unknown): boolean {
  if (a === b || Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => sameData(item, b[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => Object.hasOwn(right, key) && sameData(left[key], right[key]));
}

/** What live reload asks of the window it runs in. */
export interface LiveReloadEnv {
  /** Live reload is on, and the server's current launch is this window's. */
  active: () => boolean;
  /** A pointer is held down, or something is being dragged. */
  held: () => boolean;
  /** The editor is in Play, paused or not. */
  playing: () => boolean;
  /** What a launch would send now. */
  read: () => LaunchSnapshot;
  /** What this window's current launch sent, or `null`. */
  launched: () => LaunchSnapshot | null;
  /** Launches what was read. Never rejects: a refusal is said where it happens. */
  relaunch: (snapshot: LaunchSnapshot) => Promise<void>;
}

export interface LiveReload {
  /** Something changed: the pause starts again. */
  poke: () => void;
  dispose: () => void;
}

/**
 * The pause, and what happens when it ends.
 *
 * A pause that ends during a gesture or during Play does nothing, rather than
 * waiting: whatever ends either pokes again, so the relaunch comes a second
 * after the hand lets go or after Stop — never in the middle of a drag, whose
 * every move writes the document.
 *
 * One relaunch at a time. A launch takes a compile and a scan, and a second
 * one sent meanwhile would drop the first; a pause that ends while one is in
 * flight leaves a check for when it settles instead, which relaunches at once
 * if the screen still differs from what was launched.
 *
 * Timers are the globals', so that a test can fake them.
 */
export function createLiveReload(
  env: LiveReloadEnv,
  pauseMs = LIVE_RELOAD_PAUSE_MS,
): LiveReload {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let checkWhenSettled = false;
  let disposed = false;

  const check = (): void => {
    if (disposed || !env.active() || env.held() || env.playing()) return;
    if (inFlight) {
      checkWhenSettled = true;
      return;
    }
    const snapshot = env.read();
    const launched = env.launched();
    if (launched !== null && sameLaunchInputs(snapshot, launched)) return;
    inFlight = true;
    void env.relaunch(snapshot).finally(() => {
      inFlight = false;
      if (disposed || !checkWhenSettled) return;
      checkWhenSettled = false;
      check();
    });
  };

  return {
    poke: () => {
      if (disposed) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        check();
      }, pauseMs);
    },
    dispose: () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

/** Whether live reload relaunches in this window now. */
function isActive(): boolean {
  const { status, ownLaunch, liveReloadRefused } = useDeviceStore.getState();
  return liveReloadState(status, ownLaunch, liveReloadRefused) === 'on';
}

/**
 * Live reload, wired to this window: what pokes the pause, and what holds it.
 *
 * Every input of what Play runs pokes it whenever it is a new object — the
 * scene, the materials, the prefabs, the project, its scene list, Prefab
 * Mode's stack — and so do Stop, live reload becoming active, and the last
 * gesture let go. Whether a new object holds anything new is decided once the
 * pause ends, by content.
 *
 * Nothing in the editor says that a drag is under way. Every drag writes the
 * document on each move — the gizmo, the Inspector's sliders, knobs and colour
 * picker — and a drag held still writes nothing and looks idle; the hierarchy
 * and the asset drops are native drag-and-drop, written on `drop`. So the hold
 * is the hand itself: a pointer down anywhere in the window, until it is let
 * go, and a native drag, until it ends. Both are heard on the window while
 * capturing, so that no handler can hide them. The window's losing the focus
 * lets go of both, since a release outside it is not always seen.
 *
 * Returns what removes every listener and subscription, and ends the pause.
 */
export function watchLiveReload(target: EventTarget = window): () => void {
  const pointers = new Set<number>();
  let dragging = false;
  const held = (): boolean => pointers.size > 0 || dragging;

  const live = createLiveReload({
    active: isActive,
    held,
    playing: () => useEditorStore.getState().playState !== 'stopped',
    read: launchSnapshot,
    launched: () => useDeviceStore.getState().ownLaunch?.snapshot ?? null,
    relaunch: relaunchOnDevices,
  });

  /** The release that ends the last hold starts the pause again. */
  const release = (wasHeld: boolean): void => {
    if (wasHeld && !held()) live.poke();
  };

  const listeners: [string, (event: Event) => void][] = [
    ['pointerdown', (event) => void pointers.add(pointerIdOf(event))],
    ['pointerup', (event) => release(pointers.delete(pointerIdOf(event)))],
    ['pointercancel', (event) => release(pointers.delete(pointerIdOf(event)))],
    ['dragstart', () => (dragging = true)],
    [
      'dragend',
      () => {
        const was = dragging;
        dragging = false;
        release(was);
      },
    ],
    [
      'drop',
      () => {
        const was = dragging;
        dragging = false;
        release(was);
      },
    ],
    [
      'blur',
      (event) => {
        // Captured, every element's blur reaches here too — and the one a
        // click causes comes right after its pointer went down. Only the
        // window's own means that a release may go unseen.
        if (event.target !== target) return;
        const was = held();
        pointers.clear();
        dragging = false;
        release(was);
      },
    ],
  ];
  for (const [type, listener] of listeners) target.addEventListener(type, listener, true);

  const poke = (): void => live.poke();
  const unsubscribe = [
    useDocumentStore.subscribe((state, before) => {
      if (state.scene !== before.scene) poke();
    }),
    useAssetStore.subscribe((state, before) => {
      if (state.materials !== before.materials || state.prefabs !== before.prefabs) poke();
    }),
    useProjectStore.subscribe((state, before) => {
      if (state.project !== before.project || state.scenes !== before.scenes) poke();
    }),
    usePrefabModeStore.subscribe((state, before) => {
      if (state.stack !== before.stack) poke();
    }),
    useEditorStore.subscribe((state, before) => {
      if (state.playState === 'stopped' && before.playState !== 'stopped') poke();
    }),
    useDeviceStore.subscribe((state, before) => {
      // Turned on, a launch from this window become current, a refusal
      // cleared: what is on screen may already differ from what was sent.
      const now = liveReloadState(state.status, state.ownLaunch, state.liveReloadRefused);
      const then = liveReloadState(before.status, before.ownLaunch, before.liveReloadRefused);
      if (now === 'on' && then !== 'on') poke();
    }),
  ];

  return () => {
    for (const [type, listener] of listeners) target.removeEventListener(type, listener, true);
    for (const stop of unsubscribe) stop();
    live.dispose();
  };
}

/** A pointer event's id; `0` for an event that carries none. */
function pointerIdOf(event: Event): number {
  const id = (event as { pointerId?: unknown }).pointerId;
  return typeof id === 'number' ? id : 0;
}
