import type { Disposable, EntityId, EnvironmentDef, SceneDoc, SceneId } from '@three-studio/core';
import { Group } from 'three/webgpu';
import type { SceneApi } from '../sceneApi';

/*
 * Imported by `World.ts` and `cameras.ts`, importing neither: the claims ask
 * whether a camera hangs under a hidden scene, and the world makes the scenes.
 */

/**
 * A loaded scene's own root under the binder's: hidden until its scene starts,
 * so that three draws nothing of it — meshes, lights, shadows, water's
 * reflection — and the batcher, which leaves out what is hidden in the
 * hierarchy, groups none of it.
 */
export class SceneRoot extends Group {
  constructor(name: string) {
    super();
    this.name = name;
    this.visible = false;
  }
}

/**
 * One scene of a running world, from its load to its unload (`World.loadScene`).
 *
 * Built apart from the world's document, from a document of its own, so that
 * no subsystem mounts it and no script reaches it until it starts — as Unity's
 * objects of a scene not yet activated do not exist. At its start its records
 * move into the world's document, and its own is left empty.
 *
 * What the world reads and writes of it is public, for the world alone: a
 * host holds one to start, activate or unload it, and asks `ready` and
 * `started`.
 */
export class LoadedScene {
  readonly root: SceneRoot;
  /**
   * Settles once it is built with nothing of it in flight. Rejects if it is
   * refused, or unloaded or its world disposed first.
   */
  readonly ready: Promise<void>;
  /** Its environment, which the world's document takes while it is the active scene. */
  readonly environment: EnvironmentDef;

  /** Its own document while it builds, the world's to write; empty once it has started. */
  readonly document: SceneDoc;
  /** Its entities in tree order, as its build syncs them, and how many it has synced. */
  order: readonly EntityId[] = [];
  built = 0;
  /** What a frame gives its build, in ms; `undefined`, built at once. */
  readonly budgetMs: number | undefined;
  /** Given back at its unload. */
  holds: readonly Disposable[];
  isReady = false;
  isStarted = false;
  unloaded = false;

  private settle = (): void => {};
  private reject = (_cause: unknown): void => {};

  constructor(
    document: SceneDoc,
    /** What its scripts are given as `this.scenes`: the game's API, for this scene. */
    readonly scenes: SceneApi | null,
    budgetMs: number | undefined,
    holds: readonly Disposable[],
  ) {
    this.document = document;
    this.environment = document.environment;
    this.root = new SceneRoot(document.name);
    this.budgetMs = budgetMs;
    this.holds = holds;
    this.ready = new Promise<void>((resolve, reject) => {
      this.settle = resolve;
      this.reject = reject;
    });
    // Nobody may ask: a scene unloaded while it builds, which a switch leaves.
    this.ready.catch(() => {});
  }

  get id(): SceneId {
    return this.document.id;
  }

  get name(): string {
    return this.document.name;
  }

  /** Its components mounted and its behaviours made: in the world's document, shown. */
  get started(): boolean {
    return this.isStarted;
  }

  /** Still syncing its entities, or waiting for what they load. */
  get building(): boolean {
    return !this.isReady && !this.unloaded;
  }

  settled(): void {
    if (this.isReady || this.unloaded) return;
    this.isReady = true;
    this.settle();
  }

  failed(cause: unknown): void {
    if (this.isReady) return;
    this.reject(cause);
  }

  giveHoldsBack(): void {
    for (const hold of this.holds) hold.dispose();
    this.holds = [];
  }
}
