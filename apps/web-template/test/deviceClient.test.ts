import type { SceneHost } from '@three-studio/runtime/SceneHost';
import type { WebGPURenderer } from 'three/webgpu';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerAnnouncement } from '../src/announce';
import {
  startDeviceClient,
  type DeviceIo,
  type DeviceNotice,
  type DevicePage,
  type ProbeAnswer,
  type StreamHandlers,
} from '../src/device/client';

/*
 * The client a served page runs, with everything around it faked: the stream,
 * the posts, the page's reload and its words. What is left is what the client
 * decides — when it says hello, when it restarts, when it gives up — and that
 * is what a phone left on its bookmark depends on.
 */

const DEVICE = 'Ab3dE6gH9jK2mN5p';

interface Stream {
  handlers: StreamHandlers;
  closed: boolean;
}

function page(overrides: Partial<DevicePage> = {}): DevicePage {
  return {
    device: DEVICE,
    launch: 'L1aunch0000a',
    asked: false,
    identity: {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
      screen: { width: 393, height: 852, dpr: 3 },
      secureContext: false,
    },
    ...overrides,
  };
}

function fakeIo() {
  const streams: Stream[] = [];
  const posts: { type: string; message: Record<string, unknown> }[] = [];
  const shown: DeviceNotice[] = [];
  const answer: { probe: ProbeAnswer } = { probe: 'unreachable' };
  const reload = vi.fn();
  const io: DeviceIo = {
    openStream: (handlers) => {
      const stream: Stream = { handlers, closed: false };
      streams.push(stream);
      return {
        close: () => {
          stream.closed = true;
        },
      };
    },
    post: (type, message) => {
      posts.push({ type, message: { ...message } });
    },
    probe: () => Promise.resolve(answer.probe),
    reload,
    show: (notice) => {
      shown.push(notice);
    },
    log: () => undefined,
  };
  const last = (): Stream => streams.at(-1)!;
  return { io, streams, posts, shown, answer, reload, last };
}

function running(start = vi.fn()): PlayerAnnouncement {
  return {
    state: 'running',
    backend: 'webgl',
    renderer: {} as unknown as WebGPURenderer,
    host: {} as unknown as SceneHost,
    start,
  };
}

const message = (body: Record<string, unknown>): string => JSON.stringify({ v: 1, ...body });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('opening', () => {
  it('says hello with the launch its page runs, booting on a player page', () => {
    const fake = fakeIo();
    startDeviceClient(page(), fake.io);

    expect(fake.streams).toHaveLength(1);
    expect(fake.posts).toEqual([]);
    fake.last().handlers.onOpen();

    expect(fake.posts).toEqual([
      {
        type: 'hello',
        message: {
          v: 1,
          device: DEVICE,
          launch: 'L1aunch0000a',
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
          screen: { width: 393, height: 852, dpr: 3 },
          secureContext: false,
          state: 'booting',
          backend: null,
          error: null,
        },
      },
    ]);
    expect(fake.shown).toEqual(['connected']);
  });

  it('says it waits on the waiting page', () => {
    const fake = fakeIo();
    startDeviceClient(page({ launch: null }), fake.io);
    fake.last().handlers.onOpen();

    expect(fake.posts[0]?.message).toMatchObject({ launch: null, state: 'waiting' });
  });
});

describe('the player', () => {
  it('reports that it runs, and on what', () => {
    const fake = fakeIo();
    const client = startDeviceClient(page(), fake.io);
    fake.last().handlers.onOpen();

    client.playerAnnounced(running());

    expect(fake.posts.at(-1)).toEqual({
      type: 'status',
      message: { v: 1, device: DEVICE, state: 'running', backend: 'webgl', error: null },
    });
  });

  it('reports what it failed on', () => {
    const fake = fakeIo();
    const client = startDeviceClient(page(), fake.io);
    fake.last().handlers.onOpen();

    client.playerAnnounced({ state: 'failed', error: 'No scene to start on.' });

    expect(fake.posts.at(-1)?.message).toMatchObject({
      state: 'failed',
      error: 'No scene to start on.',
    });
  });

  it('says hello with what the player said before the stream opened', () => {
    const fake = fakeIo();
    const client = startDeviceClient(page(), fake.io);

    client.playerAnnounced(running());
    expect(fake.posts).toEqual([]);
    fake.last().handlers.onOpen();

    expect(fake.posts).toHaveLength(1);
    expect(fake.posts[0]?.message).toMatchObject({ state: 'running', backend: 'webgl' });
  });

  it('starts the game when the editor asked for this page', () => {
    const fake = fakeIo();
    const start = vi.fn();
    const client = startDeviceClient(page({ asked: true }), fake.io);

    client.playerAnnounced(running(start));

    expect(start).toHaveBeenCalledTimes(1);
  });

  it('leaves the Play screen to a page opened by hand', () => {
    const fake = fakeIo();
    const start = vi.fn();
    const client = startDeviceClient(page({ asked: false }), fake.io);

    client.playerAnnounced(running(start));

    expect(start).not.toHaveBeenCalled();
  });
});

describe('what the server says', () => {
  it('restarts once on a launch, and does nothing after it', () => {
    const fake = fakeIo();
    startDeviceClient(page(), fake.io);
    const stream = fake.last();
    stream.handlers.onOpen();
    const posted = fake.posts.length;

    stream.handlers.onMessage(message({ type: 'launch', launch: 'L2aunch0000b' }));
    stream.handlers.onMessage(message({ type: 'launch', launch: 'L3aunch0000c' }));
    vi.advanceTimersByTime(120_000);

    expect(fake.reload).toHaveBeenCalledTimes(1);
    expect(fake.posts).toHaveLength(posted);
    expect(fake.streams).toHaveLength(1);
  });

  it('says the editor stopped, and keeps saying it through the errors that follow', () => {
    const fake = fakeIo();
    startDeviceClient(page({ launch: null }), fake.io);
    const stream = fake.last();
    stream.handlers.onOpen();

    stream.handlers.onMessage(message({ type: 'stopped' }));
    stream.handlers.onError(false);

    expect(fake.shown.at(-1)).toBe('stopped');
  });

  it('ignores a message it does not know, and another version', () => {
    const fake = fakeIo();
    startDeviceClient(page(), fake.io);
    const stream = fake.last();
    stream.handlers.onOpen();
    const posted = fake.posts.length;

    stream.handlers.onMessage(message({ type: 'dance' }));
    stream.handlers.onMessage(JSON.stringify({ v: 2, type: 'launch', launch: 'L2aunch0000b' }));
    stream.handlers.onMessage('not json');

    expect(fake.reload).not.toHaveBeenCalled();
    expect(fake.posts).toHaveLength(posted);
    expect(fake.shown).toEqual(['connected']);
  });
});

describe('keeping the link alive', () => {
  it('posts its status every 20 s', () => {
    const fake = fakeIo();
    startDeviceClient(page(), fake.io);
    const stream = fake.last();
    stream.handlers.onOpen();

    for (let i = 0; i < 3; i += 1) {
      vi.advanceTimersByTime(15_000);
      stream.handlers.onMessage(message({ type: 'ping' }));
    }
    vi.advanceTimersByTime(15_000);

    expect(fake.posts.filter((post) => post.type === 'status')).toHaveLength(3);
  });

  it('reopens a stream that has said nothing for 45 s, and says hello again', () => {
    const fake = fakeIo();
    startDeviceClient(page(), fake.io);
    const first = fake.last();
    first.handlers.onOpen();

    vi.advanceTimersByTime(44_999);
    expect(fake.streams).toHaveLength(1);
    vi.advanceTimersByTime(1);

    expect(first.closed).toBe(true);
    expect(fake.streams).toHaveLength(2);
    fake.last().handlers.onOpen();
    expect(fake.posts.filter((post) => post.type === 'hello')).toHaveLength(2);
  });

  it('reopens on waking after 30 s of silence, not after 10 s', () => {
    const fake = fakeIo();
    const client = startDeviceClient(page(), fake.io);
    fake.last().handlers.onOpen();

    vi.advanceTimersByTime(10_000);
    client.wake();
    expect(fake.streams).toHaveLength(1);

    vi.advanceTimersByTime(20_000);
    client.wake();
    expect(fake.streams).toHaveLength(2);
  });

  it('says the editor cannot be reached while it connects, and connected once it has', () => {
    const fake = fakeIo();
    startDeviceClient(page(), fake.io);
    const stream = fake.last();
    stream.handlers.onOpen();

    stream.handlers.onError(false);
    expect(fake.shown.at(-1)).toBe('unreachable');
    stream.handlers.onOpen();
    expect(fake.shown.at(-1)).toBe('connected');
  });
});

describe('a stream closed for good', () => {
  it('stops for good when the link is gone', async () => {
    const fake = fakeIo();
    startDeviceClient(page(), fake.io);
    fake.last().handlers.onOpen();
    const posted = fake.posts.length;
    fake.answer.probe = 'gone';

    fake.last().handlers.onError(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(fake.shown.at(-1)).toBe('gone');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fake.streams).toHaveLength(1);
    expect(fake.posts).toHaveLength(posted);
  });

  it('tries again after 3 s, then 6 s, then 12 s, and from 3 s once a stream opens', async () => {
    const fake = fakeIo();
    startDeviceClient(page(), fake.io);
    fake.answer.probe = 'unreachable';

    const failAndWait = async (delay: number): Promise<void> => {
      const count = fake.streams.length;
      fake.last().handlers.onError(true);
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(fake.streams).toHaveLength(count);
      await vi.advanceTimersByTimeAsync(1);
      expect(fake.streams).toHaveLength(count + 1);
    };

    await failAndWait(3_000);
    expect(fake.shown.at(-1)).toBe('unreachable');
    await failAndWait(6_000);
    await failAndWait(12_000);
    fake.last().handlers.onOpen();
    await failAndWait(3_000);
  });
});
