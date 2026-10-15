import type { SceneHost } from '@three-studio/runtime/SceneHost';
import type { WebGPURenderer } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { PLAYER_EVENT, announce, type PlayerAnnouncement } from '../src/announce';

/*
 * The one thing the player says about itself: that it runs, and on what — or
 * what it failed on. A page the device server serves has a listener for it;
 * an export has none.
 */

function listen(target: EventTarget): PlayerAnnouncement[] {
  const heard: PlayerAnnouncement[] = [];
  target.addEventListener(PLAYER_EVENT, (event) => {
    heard.push((event as CustomEvent<PlayerAnnouncement>).detail);
  });
  return heard;
}

describe('the player’s announcement', () => {
  it('hands a listener the very objects the player runs', () => {
    const target = new EventTarget();
    const heard = listen(target);
    const renderer = {} as unknown as WebGPURenderer;
    const host = {} as unknown as SceneHost;
    const start = (): void => undefined;

    announce({ state: 'running', backend: 'webgl', renderer, host, start }, target);

    expect(heard).toHaveLength(1);
    const [detail] = heard;
    expect(detail?.state).toBe('running');
    if (detail?.state !== 'running') return;
    expect(detail.backend).toBe('webgl');
    expect(detail.renderer).toBe(renderer);
    expect(detail.host).toBe(host);
    expect(detail.start).toBe(start);
  });

  it('carries what the player failed on', () => {
    const target = new EventTarget();
    const heard = listen(target);

    announce({ state: 'failed', error: 'This build lists no scene to start on.' }, target);

    expect(heard).toEqual([{ state: 'failed', error: 'This build lists no scene to start on.' }]);
  });
});
