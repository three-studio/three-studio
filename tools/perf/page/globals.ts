import type { EntityId } from '@three-studio/core';
import type { SceneApi } from '@three-studio/runtime/sceneApi';
import type { PlayerAnnouncement } from '../../../apps/web-template/src/announce';

/*
 * The harness's own globals in the pages it drives, declared like the
 * editor's (`devtools.ts`), so that a page function reading them is
 * typechecked rather than cast.
 */

/** What `listenForPlayer` heard, and when the game showed. */
export type PerfPlayer =
  | (Omit<Extract<PlayerAnnouncement, { state: 'running' }>, 'start' | 'backend'> & {
      /** `performance.now()` when the init script pressed Play. */
      readonly startedAt: number;
      /** The timestamp of the first frame after that. */
      firstFrameAt: number | null;
    })
  | Extract<PlayerAnnouncement, { state: 'failed' }>;

declare global {
  interface Window {
    /** Set when the driver is done: the smoke harness's setup resolves on it, and the app exits. */
    __perfDone?: boolean;
    /** The scene API, published by the `scripted` recipe's `Director` when its scene starts. */
    __perfScenes?: SceneApi;
    __perfPlayer?: PerfPlayer;
    /** The crates `spawnCrates` placed in the running world, slot by slot: what the next call takes. */
    __perfCrates?: EntityId[];
  }
}
