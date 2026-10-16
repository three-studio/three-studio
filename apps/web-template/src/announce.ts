import type { RendererBackend } from '@three-studio/runtime/RendererFactory';
import type { SceneHost } from '@three-studio/runtime/SceneHost';
import type { WebGPURenderer } from 'three/webgpu';

/*
 * The player saying that it runs, and on what — or what it failed on.
 *
 * One DOM event, because a page the editor serves to a phone has a script
 * listening for it, and an exported build has none: an event nobody hears
 * costs nothing, and the player learns nothing about devices. Types only
 * above, so that a listener importing this file for the event's name carries
 * neither three nor the runtime.
 */

export const PLAYER_EVENT = 'three-studio:player';

export type PlayerAnnouncement =
  | {
      state: 'running';
      backend: RendererBackend;
      renderer: WebGPURenderer;
      host: SceneHost;
      /** Does what the Play button does — once, whoever asks first. */
      start: () => void;
    }
  | { state: 'failed'; error: string };

export function announce(detail: PlayerAnnouncement, target: EventTarget = window): void {
  target.dispatchEvent(new CustomEvent(PLAYER_EVENT, { detail }));
}

declare global {
  interface WindowEventMap {
    [PLAYER_EVENT]: CustomEvent<PlayerAnnouncement>;
  }
}
